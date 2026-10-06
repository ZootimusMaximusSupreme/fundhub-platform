// The Command Center's Ideas tab (build unit X8) in a real browser, offline.
//
// e2e/helpers/cc-tab-ideas-host.mjs stands in for the frame (the contract in
// docs/specs/command-center-tabs.md allows it until U34 lands) and answers
// /api/** from the API contract examples. Nothing is sent anywhere.
//
// Every tap path runs at 390x844 (Chris's phone) and at 1280x900. What it
// proves, against X8's acceptance list:
//   1. every Ideas and Funnels action sends its real route, with the body the
//      contract names and a request_id;
//   2. the cost is on the page before every paid tap, and the sheet comes
//      BEFORE the POST (no POST until the sheet's button is tapped);
//   3. Push live is two taps and the second names the address;
//   4. a part whose back end is not deployed says so in one sentence, with no
//      dead button, and nothing anywhere says "Runs in chat";
//   5. one column, no sideways scroll, every tap at least 44px at 390.
//
// EVIDENCE. With X8_PROOF_OUT set, the 390px scenarios save a screenshot and
// the live box of each element under discussion into shots/shot-marks.json;
// a copy of ops/workflows/w4b-proof-2026-09-03/_apply-marks.py burns them in as
// numbered red boxes (CLAUDE.md §8). Evidence folders are gitignored.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { mountIdeas, fixtures, flywheel, blueprintFunnel, funnelDetail } from "./helpers/cc-tab-ideas-host.mjs";

const OUT = process.env.X8_PROOF_OUT ? path.resolve(process.env.X8_PROOF_OUT) : null;
const MANIFEST = OUT ? path.join(OUT, "shots", "shot-marks.json") : null;
if (OUT) fs.mkdirSync(path.join(OUT, "shots", "_raw"), { recursive: true });

test.use({ timezoneId: "America/Phoenix", locale: "en-US" });

const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 }
];

const CHAT_WORDS = /runs in chat|still in chat|copy the chat command|in chat\b/i;

function writesTo(posts, p) { return posts.filter((x) => x.path === p); }

async function shoot(page, file, legend, marks) {
  if (!OUT) return;
  const boxes = [];
  if (marks.length) await marks[0].locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  for (const [i, m] of marks.entries()) {
    const b = await m.locator.boundingBox();
    if (!b) continue;
    const vp = page.viewportSize();
    const x = Math.max(0, Math.round(b.x)), y = Math.max(0, Math.round(b.y));
    const w = Math.min(Math.round(b.width), vp.width - x), h = Math.min(Math.round(b.height), vp.height - y);
    if (w <= 0 || h <= 0) continue;
    boxes.push({ n: i + 1, caption: m.caption, box: { x, y, w, h } });
  }
  await page.screenshot({ path: path.join(OUT, "shots", "_raw", file) });
  const all = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
  all[file] = { legend, marks: boxes };
  fs.writeFileSync(MANIFEST, JSON.stringify(all, null, 2));
}

for (const size of SIZES) {
  test.describe(`Ideas tab at ${size.width}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("draws every card, says nothing about chat, and fits the screen", async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mountIdeas(page);
      for (const h of ["Drop an idea", "The machine suggests", "Angles", "Deep research", "Offer and market", "Funnels", "Quick copy", "Proof: client wins and testimonials"]) {
        await expect(page.getByRole("heading", { name: h, exact: true })).toBeVisible();
      }
      await expect(page.locator("#cci-meter")).toHaveText("Model spend this month: $12.34 of $300.00. Nothing on this tab spends ad money.");
      const text = await page.locator("body").innerText();
      expect(text).not.toMatch(CHAT_WORDS);
      expect(text).toContain("Not on this page yet: it ships in slice 11.");
      if (size.width === 390) {
        const wide = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(wide, "no sideways scroll at 390px").toBeLessThanOrEqual(390);
        const small = await page.evaluate(() => Array.from(document.querySelectorAll("#tab-root button"))
          .filter((b) => b.offsetParent !== null)
          .map((b) => ({ t: b.textContent.trim(), h: b.getBoundingClientRect().height }))
          .filter((x) => x.h < 44));
        expect(small, "every tap is at least 44px tall").toEqual([]);
        await shoot(page, "x8-01-ideas-top-390.png", "Ideas tab at 390px", [
          { locator: page.locator("#cci-meter"), caption: "Model spend, read from GET marketing/costs" },
          { locator: page.locator("#cci-save-idea"), caption: "Save idea: free, one tap" }
        ]);
      }
      if (size.width === 1280) {
        await shoot(page, "x8-07-ideas-1280.png", "Ideas tab at 1280px", [
          { locator: page.locator("#cci-ideas"), caption: "Drop an idea + Your ideas" },
          { locator: page.locator("#cci-suggest"), caption: "The planner's 3 suggestions, Accept is free" }
        ]);
        await shoot(page, "x8-08-funnels-1280.png", "Funnels at 1280px", [
          { locator: page.locator('[data-funnel="00000000-0000-4000-8000-000000000603"] .cci-url'), caption: "The automatic address" },
          { locator: page.locator('[data-funnel="00000000-0000-4000-8000-000000000603"] .cci-pages'), caption: "Each page: status and tracked visits" }
        ]);
      }
      expect(errors).toEqual([]);
    });

    test("Drop an idea saves it with the format and funnel", async ({ page }) => {
      const { posts } = await mountIdeas(page, {
        "GET marketing/funnels": { ok: true, funnels: [{ id: "f1", key: "roadmap_147", name: "Roadmap $147", kind: null, pages: [] }], campaigns: [], ad_sets: [] },
        "POST marketing/ideas": ({ body }) => ({ ok: true, idea: { id: "new-1", source: "chris", raw_points: body.raw_points, script_format: body.script_format, funnel_key: body.funnel_key, status: "new", created_at: "2026-10-06T15:00:00Z" } })
      });
      await page.locator("#cci-idea-text").fill("Banks read the business file first.");
      await page.locator("#cci-idea-format").selectOption("sorting");
      await page.locator("#cci-idea-funnel").selectOption("roadmap_147");
      await page.locator("#cci-save-idea").click();
      await expect(page.locator('[data-say="ideas"]')).toHaveText("Saved. It goes in the next batch.");
      const w = writesTo(posts, "marketing/ideas");
      expect(w).toHaveLength(1);
      expect(w[0].body).toMatchObject({ raw_points: "Banks read the business file first.", script_format: "sorting", funnel_key: "roadmap_147" });
      expect(w[0].body.request_id).toMatch(/^[0-9a-f-]{36}$/);
      await expect(page.locator("#cci-idea-list")).toContainText("Banks read the business file first.");
    });

    test("Write now from an idea shows the cost first, then writes one script", async ({ page }) => {
      const { posts } = await mountIdeas(page, {
        "POST marketing/batches/write-now": { status: 202, body: { ok: true, queued: true, batch_id: "b1", job_id: "j1" } }
      });
      const row = page.locator('[data-idea="00000000-0000-4000-8000-000000000402"]');
      await expect(row.locator(".cci-cost")).toContainText("One script. About $0.42");
      await expect(row.locator(".cci-cost")).toContainText("$12.34 of $300.00 model spend used this month.");
      await row.getByRole("button", { name: "Write now from this idea" }).click();
      const sheet = page.getByRole("dialog", { name: "Write one script from this idea?" });
      await expect(sheet).toContainText("About $0.42");
      expect(writesTo(posts, "marketing/batches/write-now"), "no POST before the sheet's tap").toHaveLength(0);
      if (size.width === 390) await shoot(page, "x8-02-write-now-sheet-390.png", "Write now: the cost sheet comes first", [{ locator: sheet.locator(".host-box"), caption: "Cost before the paid tap" }]);
      await sheet.getByRole("button", { name: "Write it now" }).click();
      const w = writesTo(posts, "marketing/batches/write-now");
      expect(w).toHaveLength(1);
      expect(w[0].body).toMatchObject({ count: 1, idea_ids: ["00000000-0000-4000-8000-000000000402"] });
      await expect(row).toContainText("Being written");
    });

    test("Accept a suggestion and Make more of an angle make ideas", async ({ page }) => {
      const { posts } = await mountIdeas(page, {
        "POST marketing/ideas": ({ body }) => ({ ok: true, idea: { id: "i-" + posts.length, raw_points: body.raw_points, status: "new", source: body.source || "chris" } })
      });
      await expect(page.locator("#cci-suggest-list")).toContainText("$412.00 spend, 9 leads, $45.78 a lead");
      await page.locator("#cci-suggest-list").getByRole("button", { name: "Accept" }).first().click();
      await expect(page.locator("#cci-suggest-list")).toContainText("In the next batch");
      await page.locator("#cci-angle-list").getByRole("button", { name: "Make more of this" }).first().click();
      await expect(page.locator("#cci-angle-list")).toContainText("In the next batch");
      const w = writesTo(posts, "marketing/ideas");
      expect(w).toHaveLength(2);
      expect(w[0].body).toMatchObject({ source: "suggestion", angle_key: "two-files" });
      expect(w[1].body).toMatchObject({ angle_key: "two-files" });
    });

    test("Build the avatar: cost and caps under the button, sheet, then the run and its live step", async ({ page }) => {
      let started = false;
      const { posts } = await mountIdeas(page, {
        "GET marketing/flywheel": () => flywheel({ running: started }),
        "POST marketing/flywheel/run": () => { started = true; return { status: 202, body: { ok: true, started: true, already_running: false, job: { id: "job-avatar", status: "queued" }, poll: "marketing/flywheel/job?id=job-avatar" } }; }
      });
      const row = page.locator("#cci-stage-1");
      await expect(row).toContainText("Who we sell to");
      await expect(row).toContainText("Not run yet");
      /* "step 1 of 6" stays on one line beside the chip (it broke as "step 1 of / 6" at 390). */
      const step = row.locator(".cci-step");
      await expect(step).toHaveText("step 1 of 6");
      const lines = await step.evaluate((el) => el.getClientRects().length);
      expect(lines, "the step caption is one line box").toBe(1);
      const cost = page.locator("#cci-cost-1");
      await expect(cost).toContainText("Cost: unknown, not measured yet.");
      await expect(cost).toContainText("It stops by itself at $20.00.");
      await expect(cost).toContainText("At most 184 web searches ($1.84");
      const run = page.locator("#cci-run-1");
      await expect(run).toHaveText("Build the avatar");
      await expect(run).toHaveClass(/primary/);
      await page.locator("#cci-sell").fill("Funding for business owners, done for you.");
      if (size.width === 390) await shoot(page, "x8-03-build-avatar-390.png", "Build the avatar: cost before the tap", [
        { locator: run, caption: "Build the avatar (the card's one filled button)" },
        { locator: cost, caption: "Cost, caps and searches from GET marketing/costs" }
      ]);
      await run.click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toContainText("Cost: unknown, not measured yet.");
      expect(writesTo(posts, "marketing/flywheel/run")).toHaveLength(0);
      await sheet.getByRole("button", { name: "Build the avatar" }).click();
      const w = writesTo(posts, "marketing/flywheel/run");
      expect(w).toHaveLength(1);
      expect(w[0].body).toMatchObject({ campaign: "partner", stage: 1, kind: "avatar", service_description: "Funding for business owners, done for you." });
      await expect(row).toContainText("Running: step 3 of 10, searching the web for buyer quotes, round 2.");
      await expect(row).toContainText("$1.90 spent so far, 23 searches.");
    });

    test("Research the market, Read it, Approve and Tweak a stage", async ({ page }) => {
      let approved = false;
      const { posts } = await mountIdeas(page, {
        "GET marketing/flywheel": () => flywheel({ approved2: approved }),
        "POST marketing/flywheel/approve": () => { approved = true; return { ok: true, stage: 2, outbox_id: "o1" }; },
        "POST marketing/flywheel/tweak": { status: 202, body: { ok: true, job: { id: "j2" }, outbox_id: "o2" } }
      });
      const row = page.locator("#cci-stage-2");
      await expect(row.locator("#cci-cost-2")).toContainText("At most 106 web searches ($1.06), 138 if a slow part is tried again ($1.38).");
      await expect(row.locator("#cci-cost-2")).toContainText("It cannot go past $40.00 a run.");
      await row.getByRole("button", { name: "Read it" }).click();
      await expect(row).toContainText("What this decided");
      await expect(row.getByRole("link", { name: "marketing/flywheel/partner/02-ad-research.md" })).toHaveAttribute("href", /github\.com/);
      await row.getByRole("button", { name: "Approve" }).click();
      await expect(row).toContainText("Done, approved");
      expect(writesTo(posts, "marketing/flywheel/approve")[0].body).toMatchObject({ campaign: "partner", stage: 2 });
      await row.getByRole("button", { name: "Tweak" }).click();
      await row.locator("#cci-tw-2").fill("Look harder at bank overlays.");
      await row.getByRole("button", { name: "Save and re-run step 2" }).click();
      const sheet = page.getByRole("dialog", { name: "Tweak step 2?" });
      await expect(sheet).toContainText("makes steps 3 to 6 out of date");
      expect(writesTo(posts, "marketing/flywheel/tweak")).toHaveLength(0);
      await sheet.getByRole("button", { name: "Save and re-run" }).click();
      expect(writesTo(posts, "marketing/flywheel/tweak")[0].body).toMatchObject({ campaign: "partner", stage: 2, note: "Look harder at bank overlays." });
      /* Steps 4 and 5 wait on approvals, with the reason printed. */
      await expect(page.locator("#cci-stage-4")).toContainText("Approve step 3 first (the offer).");
      await expect(page.locator("#cci-run-4")).toBeDisabled();
      await expect(page.locator("#cci-stage-5")).toContainText("Approve steps 3 and 4 first (the offer and the copy).");
    });

    /* Unit GL: a finished offer run waits on row 3 with no file yet; Approve saves it as
       step 3 (the server writes 03-offer.md from the run), and the copy can then run. */
    test("a finished offer waits on row 3: Read it shows the run's offer, Approve saves it as step 3", async ({ page }) => {
      let approved = false;
      const waitingRow = () => approved
        ? { n: 3, key: "offer", state: "READY", approved: true, state_word: "Done, approved", sentence: "Done. Price set, 3 bonuses. Version 1. Approved.", source: "outbox-pending", run: { job_id: "offer-9", kind: "offer", status: "done" }, can_approve: true, offer_waiting: null, files: [{ path: "marketing/flywheel/capital-blueprint/03-offer.md", github_url: "" }] }
        : { n: 3, key: "offer", state: "MISSING", approved: false, state_word: "Done", sentence: "Done. A new offer is ready to read (written Oct 6). Approve saves it as step 3.",
            source: "missing", run: { job_id: "offer-9", kind: "offer", status: "done" }, can_run: { ok: true, reason: null }, can_approve: true,
            offer_waiting: { job_id: "offer-9", finished_at: "2026-10-06T15:00:00.000Z", replaces_file: false },
            review_card_md: "## Review card\n\n**What this decided:** Sell the Capital Blueprint at $5,000.", document_md: "# Offer — capital-blueprint\n\nA funding plan in 30 days.", files: [] };
      const answer = () => {
        const f = flywheel();
        f.campaign = "capital-blueprint";
        f.stages = f.stages.map((s) => (s.n === 3 ? waitingRow() : s.n === 4 && approved ? { ...s, can_run: { ok: true, reason: null } } : s));
        return f;
      };
      const { posts } = await mountIdeas(page, {
        "GET marketing/flywheel": answer,
        "GET marketing/flywheel?campaign=capital-blueprint": answer,
        "POST marketing/flywheel/approve": () => { approved = true; return { ok: true, campaign: "capital-blueprint", stage: 3, file: "03-offer.md", outbox_id: 7, already_approved: false, written_from_job: "offer-9", version: 1 }; }
      });
      const row = page.locator("#cci-stage-3");
      await expect(row).toContainText("A new offer is ready to read");
      await expect(row).toContainText("Approve saves it as step 3.");
      await row.getByRole("button", { name: "Read it" }).click();
      await expect(row).toContainText("Sell the Capital Blueprint at $5,000.");
      const approve = row.getByRole("button", { name: "Approve" });
      await expect(approve).toBeVisible();
      if (size.width === 390) {
        const box = await approve.boundingBox();
        expect(box.height, "a 44px tap target").toBeGreaterThanOrEqual(44);
        await shoot(page, "gl-01-offer-waiting-390.png", "A finished offer waits on row 3", [
          { locator: row.locator(".cci-sentence").first(), caption: "What Approve does, in one sentence" },
          { locator: approve, caption: "Approve saves the run as step 3 (03-offer.md)" }
        ]);
      }
      await approve.click();
      const w = writesTo(posts, "marketing/flywheel/approve");
      expect(w).toHaveLength(1);
      expect(w[0].body).toMatchObject({ stage: 3 });
      expect(typeof w[0].body.request_id).toBe("string");
      await expect(row).toContainText("Done, approved");
      await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0);
    });

    test("Write the offer runs step 3 through the flywheel route; Read the spend is free", async ({ page }) => {
      const { posts } = await mountIdeas(page, {
        "POST marketing/flywheel/run": { status: 202, body: { ok: true, stage: 3, job: { id: "offer-1", status: "queued" } } },
        "POST marketing/flywheel/spend-read": { ok: true, rows: [{ ad_number: "84", spend_cents: 49801, taps: 120, cpl_cents: null, purchases: 0 }], unmatched: [], conclusion: { text: "Clicks are fine, cost per lead is high: redo the offer.", points_to_stage: 3 } }
      });
      await expect(page.locator("#cci-cost-3")).toContainText("About $0.67 and 5 minutes (last run, Oct 4).");
      await page.locator("#cci-run-3").click();
      await page.getByRole("dialog").getByRole("button", { name: "Write the offer" }).click();
      expect(writesTo(posts, "marketing/flywheel/run")[0].body).toMatchObject({ campaign: "partner", stage: 3, kind: "offer" });
      expect(writesTo(posts, "marketing/offer/generate")).toHaveLength(0);
      await expect(page.locator("#cci-stage-6")).toContainText("Free. Reads saved numbers. A few seconds.");
      await page.locator("#cci-run-6").click();
      await expect(page.locator("#cci-stage-6")).toContainText("$498.01");
      await expect(page.locator("#cci-stage-6")).toContainText("unknown");
      await expect(page.locator("#cci-stage-6")).toContainText("Clicks are fine, cost per lead is high: redo the offer.");
      expect(writesTo(posts, "marketing/flywheel/spend-read")[0].body).toMatchObject({ campaign: "partner" });
    });

    test("Start a flywheel for any offer key", async ({ page }) => {
      const { posts } = await mountIdeas(page, {
        "POST marketing/flywheel/campaign": { status: 201, body: { ok: true, campaign: "capital-blueprint" } }
      });
      await page.locator("#cci-new-offer").selectOption("UWIQ_DELIVERABLES");
      await page.getByRole("button", { name: "Start a flywheel" }).click();
      await expect(page.locator('[data-say="flywheel"]')).toContainText("Started.");
      expect(writesTo(posts, "marketing/flywheel/campaign")[0].body).toMatchObject({ key: "UWIQ_DELIVERABLES" });
    });

    test("Deep research: stop amount first, cost from the server's limits, then the run", async ({ page }) => {
      const { posts } = await mountIdeas(page, {
        "POST marketing/research": { status: 202, body: { ok: true, started: true, already_running: false, job: { id: "r-new", status: "queued" } } },
        "POST marketing/jobs/retry": { ok: true, job: { id: "r-failed", kind: "deep_research", status: "queued" } }
      });
      const go = page.locator("#cci-research-go");
      await expect(go).toBeDisabled();
      await expect(page.locator("#cci-research-cost")).toHaveText("Type a stop amount first.");
      await expect(page.locator("#cci-depth-deep")).toBeDisabled();
      await expect(page.locator("#cci-depth-why")).toHaveText("Run a Quick look first so the cost of a full run gets measured.");
      await page.locator("#cci-q").fill("Which banks give business credit lines to new companies?");
      await page.locator("#cci-cap").fill("5");
      await expect(go).toBeEnabled();
      const cost = page.locator("#cci-research-cost");
      await expect(cost).toContainText("About 62 web searches.");
      await expect(cost).toContainText("about $0.62 in search fees");
      await expect(cost).toContainText("It stops at your cap: $5.00 for this run.");
      if (size.width === 390) await shoot(page, "x8-04-deep-research-390.png", "Deep research: cost before the tap", [
        { locator: go, caption: "Research it (needs a stop amount)" },
        { locator: cost, caption: "Searches, fees and the cap, worked out in code" }
      ]);
      await go.click();
      const sheet = page.getByRole("dialog", { name: "Start the research?" });
      await expect(sheet).toContainText("Deep research on: Which banks give business credit lines to new companies?");
      expect(writesTo(posts, "marketing/research")).toHaveLength(0);
      await sheet.getByRole("button", { name: "Start the research" }).click();
      const w = writesTo(posts, "marketing/research");
      expect(w).toHaveLength(1);
      expect(w[0].body).toMatchObject({ question: "Which banks give business credit lines to new companies?", depth: "quick", sources: { web: true, vault: true, own_files: false }, max_cost_usd: 5 });
      /* The done row: Read it unfolds the report with its links. */
      const done = page.locator('[data-run="r-done"]');
      await expect(done).toContainText("Done, 11 of 14 key claims held up.");
      await expect(done).toContainText("Not in the repo yet.");
      await done.getByRole("button", { name: "Read it" }).click();
      await expect(done.getByRole("link", { name: "Bank guide" })).toHaveAttribute("href", "https://example.com/bank-guide");
      await expect(done).toContainText("What we could not reach");
      /* The failed row: Retry is free and goes to the shared retry route. */
      const failed = page.locator('[data-run="r-failed"]');
      await expect(failed).toContainText("Could not finish: Anthropic's reader could not open any page.");
      await failed.getByRole("button", { name: "Retry" }).click();
      expect(writesTo(posts, "marketing/jobs/retry")[0].body).toMatchObject({ job_id: "r-failed" });
    });

    test("Funnels: make one (automatic address), rename it, see the pages, push live in two taps", async ({ page }) => {
      let path = "/blueprint";
      let made = false;
      const list = () => ({ ok: true, funnels: [blueprintFunnel({ path }), ...(made ? [blueprintFunnel({ id: "00000000-0000-4000-8000-000000000604", key: "blueprint-2", path: "/blueprint-2", pages: "empty" })] : [])], campaigns: [], ad_sets: [] });
      const { posts } = await mountIdeas(page, {
        "GET marketing/funnels": list,
        "GET marketing/funnel": () => funnelDetail({ path }),
        "POST marketing/funnels/create": () => {
          made = true;
          return { ok: true, funnel: blueprintFunnel({ id: "00000000-0000-4000-8000-000000000604", key: "blueprint-2", path: "/blueprint-2", pages: "empty" }), job: { id: "job-f2", kind: "funnel", status: "queued", created_at: "2026-10-06T15:00:00Z" }, worker: { started: true, reason: null } };
        },
        "POST marketing/funnels/rename": ({ body }) => { path = "/" + body.path; return { ok: true, funnel: blueprintFunnel({ path }) }; },
        "POST marketing/funnels/push-live": { status: 202, body: { ok: true, queued: true, job: { id: "job-push", kind: "funnel_push", status: "queued" }, url: "https://apply.fundhub.ai/blueprint-vip", worker: { started: true, reason: null } } }
      });
      /* Make the funnel: cost first, then the automatic address. */
      await expect(page.locator("#cci-funnel-cost")).toContainText("Writes 3 pages with one model call.");
      await page.locator("#cci-funnel-go").click();
      const make = page.getByRole("dialog", { name: "Make a new funnel?" });
      await expect(make).toContainText("Cost: unknown, not measured yet.");
      expect(writesTo(posts, "marketing/funnels/create")).toHaveLength(0);
      await make.getByRole("button", { name: "Make the funnel" }).click();
      expect(writesTo(posts, "marketing/funnels/create")[0].body).toMatchObject({ offer_key: "capital_blueprint" });
      expect(writesTo(posts, "marketing/funnels/create")[0].body.path).toBeUndefined();
      await expect(page.locator('[data-say="funnels"]')).toHaveText("Made. Its address is https://apply.fundhub.ai/blueprint-2. Tag fnl-blueprint-2.");
      const fresh = page.locator('[data-funnel="00000000-0000-4000-8000-000000000604"]');
      await expect(fresh).toContainText("Writing the 3 pages.");
      await expect(fresh.getByRole("button", { name: "Push live" })).toBeDisabled();

      /* The built draft: tag, tracking, pages and their status. */
      const row = page.locator('[data-funnel="00000000-0000-4000-8000-000000000603"]');
      await expect(row).toContainText("apply.fundhub.ai/blueprint");
      await expect(row).toContainText("Tag fnl-blueprint and the full tracking are on every page.");
      await expect(row).toContainText("Its ads are tagged uwiq plus the ad number.");
      await expect(row).not.toContainText("utm_campaign=");
      await expect(row).toContainText("Written, not live");

      /* Rename: free, one tap after typing. */
      await row.getByRole("button", { name: "Change the address" }).click();
      await row.locator("#cci-rn-00000000-0000-4000-8000-000000000603").fill("blueprint-vip");
      await row.getByRole("button", { name: "Save the address" }).click();
      expect(writesTo(posts, "marketing/funnels/rename")[0].body).toMatchObject({ id: "00000000-0000-4000-8000-000000000603", path: "blueprint-vip" });
      await expect(row).toContainText("apply.fundhub.ai/blueprint-vip");

      /* Page previews: sandboxed, no scripts. */
      await row.getByRole("button", { name: "See the pages" }).click();
      const frame = row.locator("iframe.cci-frame");
      await expect(frame).toHaveAttribute("sandbox", "");
      await expect(page.frameLocator('[data-funnel="00000000-0000-4000-8000-000000000603"] iframe.cci-frame').getByRole("heading")).toHaveText("Know exactly what stands between you and funding");
      await row.getByRole("tab", { name: "Booking page" }).click();
      await expect(page.frameLocator('[data-funnel="00000000-0000-4000-8000-000000000603"] iframe.cci-frame').getByRole("heading")).toHaveText("Pick the time that works for you");

      /* Push live: tap one opens the confirm naming the address; nothing is sent. */
      const push = row.getByRole("button", { name: "Push live" });
      await push.click();
      const confirm = page.getByRole("dialog");
      await expect(confirm).toContainText("apply.fundhub.ai/blueprint-vip");
      await expect(confirm).toContainText("Costs $0. No ad is made or changed.");
      expect(writesTo(posts, "marketing/funnels/push-live"), "first tap sends nothing").toHaveLength(0);
      if (size.width === 390) await shoot(page, "x8-05-push-live-confirm-390.png", "Push live: the second tap names the address", [{ locator: confirm.getByRole("button", { name: "Push live to apply.fundhub.ai/blueprint-vip" }), caption: "Second tap names the URL" }]);
      await confirm.getByRole("button", { name: "Push live to apply.fundhub.ai/blueprint-vip" }).click();
      const w = writesTo(posts, "marketing/funnels/push-live");
      expect(w).toHaveLength(1);
      expect(w[0].body).toMatchObject({ id: "00000000-0000-4000-8000-000000000603", confirm_url: "https://apply.fundhub.ai/blueprint-vip" });
      await expect(row).toContainText("Pushing live: making the pages and checking them.");
    });

    test("search ceilings come from the server: a changed limit changes the line", async ({ page }) => {
      const base = fixtures();
      await mountIdeas(page, {
        "GET marketing/costs": { ...base["GET marketing/costs"], limits: { avatar: { steps: 7, max_searches: 200, max_search_usd: 2 } } },
        "GET marketing/research": { ...base["GET marketing/research"], limits: { quick: { searches: 70, search_usd: 0.7 }, deep: { searches: 600, search_usd: 6 } } }
      });
      await expect(page.locator("#cci-cost-1")).toContainText("At most 200 web searches ($2.00 of it is search");
      await page.locator("#cci-cap").fill("5");
      const cost = page.locator("#cci-research-cost");
      await expect(cost).toContainText("About 70 web searches.");
      await expect(cost).toContainText("about $0.70 in search fees");
    });

    test("research that did not load: Research it is off and says why", async ({ page }) => {
      await mountIdeas(page, { "GET marketing/research": { status: 500, body: { ok: false, error: "internal_error" } } });
      await page.locator("#cci-cap").fill("5");
      await expect(page.locator("#cci-research-go")).toBeDisabled();
      await expect(page.locator("#cci-research-cost")).toHaveText("Your research did not load, so nothing can start. Tap Try again below.");
      await expect(page.locator("#cci-research-list").getByRole("button", { name: "Try again" })).toBeVisible();
      if (size.width === 390) await shoot(page, "x8-11-research-reason-390.png", "Research it is off and says why", [
        { locator: page.locator("#cci-research-go"), caption: "Research it: off" },
        { locator: page.locator("#cci-research-cost"), caption: "The reason, printed beside it" }
      ]);
    });

    test("a funnel with no pages yet: See the pages is off and says why", async ({ page }) => {
      await mountIdeas(page, { "GET marketing/funnels": { ok: true, funnels: [blueprintFunnel({ pages: "empty" })], campaigns: [], ad_sets: [] } });
      const row = page.locator('[data-funnel="00000000-0000-4000-8000-000000000603"]');
      await expect(row.getByRole("button", { name: "See the pages" })).toBeDisabled();
      await expect(row.locator('[data-why="see-pages"]')).toHaveText("See the pages: write the pages first.");
      if (size.width === 390) await shoot(page, "x8-10-see-pages-reason-390.png", "See the pages is off and says why", [
        { locator: row.getByRole("button", { name: "See the pages" }), caption: "See the pages: off" },
        { locator: row.locator('[data-why="see-pages"]'), caption: "The reason, printed under it" },
        { locator: row.locator(".cci-row-text + *, .cci-muted").filter({ hasText: "Its ads are tagged" }).first(), caption: "Plain words for the ad tag" }
      ]);
    });

    for (const mode of ["promise", "both"]) {
      test(`a frame whose sheets answer by ${mode}: a yes sends once, a no sends nothing`, async ({ page }) => {
        const { posts } = await mountIdeas(page, {
          "GET marketing/funnels": { ok: true, funnels: [blueprintFunnel({})], campaigns: [], ad_sets: [] },
          "POST marketing/funnels/push-live": { status: 202, body: { ok: true, queued: true, job: { id: "job-push", kind: "funnel_push", status: "queued" }, url: "https://apply.fundhub.ai/blueprint", worker: { started: true, reason: null } } },
          "POST creative/generate": { ok: true, created: true, provider_ready: true, job: { id: "cj1" } },
          "POST creative/run": { ok: true, jobs: [{ job_id: "cj1", status: "succeeded", assets: [] }] }
        }, { confirmMode: mode });
        /* A paid tap: Cancel sends nothing, then one yes sends one. */
        await page.locator("#cci-quick-angle").fill("Turned down by the bank");
        await page.locator("#cci-quick-go").click();
        await page.getByRole("dialog", { name: "Write one piece of quick copy?" }).getByRole("button", { name: "Cancel" }).click();
        await page.waitForTimeout(200);
        expect(writesTo(posts, "creative/generate"), "a no sends nothing").toHaveLength(0);
        await page.locator("#cci-quick-go").click();
        await page.getByRole("dialog", { name: "Write one piece of quick copy?" }).getByRole("button", { name: "Write it" }).click();
        await expect(page.locator('[data-say="quick"]')).toContainText("Done.");
        expect(writesTo(posts, "creative/generate"), "one yes, one write").toHaveLength(1);
        /* Push live: the second tap sends exactly one push. */
        const row = page.locator('[data-funnel="00000000-0000-4000-8000-000000000603"]');
        await row.getByRole("button", { name: "Push live" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Push live to apply.fundhub.ai/blueprint" }).click();
        await expect(row).toContainText("Pushing live: making the pages and checking them.");
        await page.waitForTimeout(200);
        expect(writesTo(posts, "marketing/funnels/push-live"), "one yes, one push").toHaveLength(1);
      });
    }

    test("Quick copy: cost first, then one piece through the copy runner", async ({ page }) => {
      const { posts } = await mountIdeas(page, {
        "POST creative/generate": { ok: true, created: true, provider_ready: true, job: { id: "cj1" } },
        "POST creative/run": { ok: true, jobs: [{ job_id: "cj1", status: "succeeded", assets: [] }] }
      });
      await expect(page.locator("#cci-quick-cost")).toContainText("Writes one piece. About a minute.");
      await expect(page.locator("#cci-quick-list")).toContainText("Passed the ad rules check · claude-opus-5-5");
      await expect(page.locator("#cci-quick-list")).toContainText("Funding ads may not promise approval.");
      await page.locator("#cci-quick-angle").fill("Turned down by the bank");
      await page.locator("#cci-quick-go").click();
      await page.getByRole("dialog", { name: "Write one piece of quick copy?" }).getByRole("button", { name: "Write it" }).click();
      await expect(page.locator('[data-say="quick"]')).toContainText("Done.");
      expect(writesTo(posts, "creative/generate")[0].body).toMatchObject({ partner_id: "11111111-2222-4333-8444-555555555555", asset_kind: "copy", prompt: "Turned down by the bank" });
      expect(writesTo(posts, "creative/run")[0].body).toMatchObject({ max_jobs: 1 });
    });

    test("not deployed yet: honest sentences, unknown costs, and no dead buttons", async ({ page }) => {
      await mountIdeas(page, {
        "GET marketing/costs": null,
        "GET marketing/flywheel": null,
        "GET marketing/research": null,
        "GET marketing/batches/next": null,
        "GET marketing/angles": null
      });
      await expect(page.locator("#cci-meter")).toHaveText("Model spend this month: unknown, not measured yet. Nothing on this tab spends ad money.");
      await expect(page.locator("#cci-flywheel")).toContainText("Not on this page yet: it ships in slice 5.");
      await expect(page.locator("#cci-research")).toContainText("Not on this page yet: it ships in slice 10.");
      await expect(page.locator("#cci-suggest")).toContainText("Not on this page yet: it ships in slice 3.");
      await expect(page.locator("#cci-angles")).toContainText("Not on this page yet: it ships in slice 4.");
      for (const card of ["#cci-flywheel", "#cci-research", "#cci-suggest", "#cci-angles", "#cci-proof"]) {
        await expect(page.locator(card + " button"), card + " has no dead button").toHaveCount(0);
      }
      await expect(page.locator("#cci-funnel-cost")).toContainText("Cost: unknown, not measured yet.");
      await expect(page.locator("#cci-quick-cost")).toContainText("Model spend this month: unknown, not measured yet.");
      const text = await page.locator("body").innerText();
      expect(text).not.toMatch(CHAT_WORDS);
      if (size.width === 390) await shoot(page, "x8-06-not-built-390.png", "Not deployed yet: one honest sentence, no dead button", [
        { locator: page.locator("#cci-research .cci-honest"), caption: "Deep research: honest sentence until slice 10" }
      ]);
    });

    test("a part that fails says so and the rest stays painted", async ({ page }) => {
      await mountIdeas(page, {
        "GET marketing/funnels": { status: 500, body: { ok: false, error: "internal_error" } }
      });
      await expect(page.locator("#cci-funnel-list")).toContainText("The funnels did not load. The rest of this page is current.");
      await expect(page.locator("#cci-funnel-list").getByRole("button", { name: "Try again" })).toBeVisible();
      await expect(page.locator("#cci-idea-list")).toContainText("Lenders read two files");
    });
  });
}
