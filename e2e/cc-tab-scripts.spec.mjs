// The Command Center's Scripts tab (plan unit U36) in a real browser, offline.
//
// The frame (U34) is being built at the same time, so the tab runs inside the
// stub frame in e2e/helpers/cc-tab-harness.mjs (docs/specs/command-center-tabs.md
// allows this until the frame lands). page.route answers /api/** with the API
// contract's own examples (src/marketing/api-contract.mjs), so the requests
// this screen sends are checked against the shapes the real routes take.
// No database, no session, nothing sent anywhere.
//
// The phone tap paths Chris uses on a Monday, at 390x844:
//   approve, edit (with a stale save), fix (with "Make this a rule"), reject,
//   film order, Write now, an idea, a rule, every version, and a swipe that
//   moves cards and never saves.
// Then the four states, the 390 layout (one column, no sideways scroll, text
// 11px or larger, taps 40px or larger), polling only while the tab is on
// screen, and the same tab at 1280.

import { test, expect } from "@playwright/test";
import { CONTRACT, exampleResponse } from "../src/marketing/api-contract.mjs";
import { openTabHarness } from "./helpers/cc-tab-harness.mjs";

test.use({ timezoneId: "America/Phoenix", locale: "en-US" });

const NOW = "2026-10-12T16:00:00Z";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const R91 = "00000000-0000-4000-8000-000000000901";
const R92 = "00000000-0000-4000-8000-000000000902";
const RREJ = "00000000-0000-4000-8000-000000000903";

/* ── fixtures: the contract's examples, plus a flagged draft and two approved scripts ── */

function drafts() {
  const [a, b] = exampleResponse("GET marketing/scripts").scripts;
  b.flagged = true;
  b.check_results = {
    version: 1, flagged: true,
    flag_reasons: ["It still fails the rule checker after 2 rewrite rounds."],
    strict: { passed: false, rounds: 2, failures: [{ rule: "round two", message: "It says \"round two\".", line: 2 }], warnings: [] },
    judge: { passed: true, ran: true, notes: [] },
    compliance: { state: "passed", reasons: [], copy_blocked: false, engine_blocked: false }
  };
  return [a, b];
}

function locked(n, root, filmOrder = null) {
  const s = exampleResponse("GET marketing/scripts").scripts[0];
  return { ...s, id: root, root_script_id: root, status: "locked", ad_id: String(n), title: `Script for Ad ${n}`, film_order: filmOrder, locked_at: "2026-10-12T15:00:00.000Z" };
}

function rejected() {
  const s = exampleResponse("GET marketing/scripts").scripts[0];
  return { ...s, id: RREJ, root_script_id: RREJ, status: "rejected", title: "Too close to Ad 84", rejected_reason: "Too close to Ad 84.", rejected_at: "2026-10-12T15:10:00.000Z" };
}

/** The API, answered from fixtures. `over` swaps any route: "METHOD path" -> (req) => [status, body]. */
function api(over = {}) {
  const db = {
    scripts: [...drafts(), locked(91, R91), locked(92, R92), rejected()],
    batches: exampleResponse("GET marketing/batches"),
    ideas: exampleResponse("GET marketing/ideas").ideas,
    rules: exampleResponse("GET marketing/rules")
  };
  const routes = {
    "GET marketing/scripts": () => [200, { scripts: db.scripts, as_of: NOW }],
    "GET marketing/script": ({ query }) => {
      const ex = exampleResponse("GET marketing/script");
      return [200, { ...ex, script: { ...ex.script, id: query.id } }];
    },
    "GET marketing/batches": () => [200, db.batches],
    "GET marketing/settings": () => [200, exampleResponse("GET marketing/settings")],
    "GET marketing/funnels": () => [200, exampleResponse("GET marketing/funnels")],
    "GET marketing/ideas": () => [200, { ideas: db.ideas }],
    "GET marketing/rules": () => [200, db.rules],
    "POST marketing/scripts/approve": ({ body }) => {
      const s = db.scripts.find((x) => x.id === body.id);
      const out = { ...s, status: "locked", ad_id: "93", locked_at: NOW };
      db.scripts = db.scripts.map((x) => (x.id === s.id ? out : x));
      return [200, { script: out, ad_number: "93", registry: "skipped", registry_note: "The sorting lane has no rule in the ad list (registry.json), so Ad 93 was not added to it. That is on purpose. The ad still tracks by its number." }];
    },
    "POST marketing/scripts/edit": ({ body }) => {
      const s = db.scripts.find((x) => x.id === body.id);
      const out = { ...s, id: "00000000-0000-4000-8000-000000000102", version: s.version + 1, body: body.body, parts: body.parts ?? s.parts };
      db.scripts = db.scripts.map((x) => (x.id === s.id ? out : x));
      return [200, { script: out, warnings: CONTRACT["POST marketing/scripts/edit"].example.response.warnings }];
    },
    "POST marketing/scripts/fix": () => [202, exampleResponse("POST marketing/scripts/fix")],
    "POST marketing/scripts/reject": ({ body }) => {
      const s = db.scripts.find((x) => x.id === body.id);
      const out = { ...s, status: "rejected", rejected_reason: body.reason || "rejected from the app, no reason given" };
      db.scripts = db.scripts.map((x) => (x.id === s.id ? out : x));
      return [200, { script: out }];
    },
    "POST marketing/scripts/order": () => [200, { ok: true }],
    "POST marketing/batches/write-now": () => [202, exampleResponse("POST marketing/batches/write-now")],
    "POST marketing/ideas": ({ body }) => {
      const idea = { ...exampleResponse("POST marketing/ideas").idea, raw_points: body.raw_points, script_format: body.script_format ?? null, funnel_key: body.funnel_key ?? null };
      db.ideas = [idea, ...db.ideas];
      return [200, body.write_now ? { idea, batch_id: "00000000-0000-4000-8000-000000000302", job_id: "00000000-0000-4000-8000-000000000502" } : { idea }];
    },
    "POST marketing/rules": ({ body }) => {
      db.rules = { ...db.rules, recent: [{ op_id: "00000000-0000-4000-8000-000000000b09", action: body.action, text: body.text, state: "waiting", committed_sha: null, at: NOW }, ...db.rules.recent] };
      return [202, { queued: true, op_id: "00000000-0000-4000-8000-000000000b09" }];
    },
    ...over
  };
  return { db, routes };
}

async function wire(page, { routes }) {
  const calls = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\//, "");
    const query = Object.fromEntries(url.searchParams);
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const key = `${req.method()} ${p}`;
    calls.push({ key, body, query });
    const fn = routes[key];
    if (!fn) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found", message: "Not mocked here." }) });
    const [status, json] = await fn({ body, query, calls });
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
  });
  return calls;
}

async function open(page, a = api(), { param = "" } = {}) {
  await page.clock.install({ time: new Date(NOW) });
  const calls = await wire(page, a);
  await openTabHarness(page, { tab: "scripts", param });
  return calls;
}

const posts = (calls, key) => calls.filter((c) => c.key === key);
const card = (page) => page.locator("article.ccs-card");

/* ── the Monday tap paths, at 390 ─────────────────────────────────────────── */

test.describe("Scripts tab on a phone (390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("needs a look comes first; Approve gives the ad number and moves to the next card", async ({ page }) => {
    const calls = await open(page);
    await expect(page.getByRole("heading", { name: "2 scripts waiting for you" })).toBeVisible();
    await expect(card(page)).toContainText("Draft 1 of 2 · Book a call · sorting hat short");
    await expect(card(page).locator(".chip", { hasText: "needs a look" })).toBeVisible();
    await expect(card(page)).toContainText("Needs a look: It still fails the rule checker after 2 rewrite rounds. Approve anyway if you like it.");

    const approve = page.getByRole("button", { name: "Approve", exact: true });
    expect((await approve.boundingBox()).height).toBeGreaterThanOrEqual(56);
    await approve.click();
    await expect(page.locator(".ccs-say.show")).toContainText("Approved. This is Ad 93.");
    await expect(card(page)).toContainText("Draft 1 of 1 · Roadmap $147 · standard");

    const [p] = posts(calls, "POST marketing/scripts/approve");
    expect(p.body.id).toBe("00000000-0000-4000-8000-000000000201");
    expect(p.body.version).toBe(1);
    expect(p.body.request_id).toMatch(UUID);

    await page.getByRole("button", { name: /^Approved/ }).click();
    await expect(page.locator(".ccs-row", { hasText: "Ad 93" })).toBeVisible();
  });

  test("Edit: one box per part; the checker warns but never blocks", async ({ page }) => {
    const calls = await open(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(card(page)).toContainText("Draft 2 of 2 · Roadmap $147 · standard");
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Hook (first line)")).toHaveValue("MOST lenders read TWO files before they say yes.");
    await expect(page.getByLabel("Cue 3")).toHaveValue("which one they read first");
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await page.getByLabel("Call to action").fill("Tap below and see your number today.");
    await page.getByRole("button", { name: "Save new version" }).click();

    await expect(page.locator(".ccs-say.show")).toContainText("Saved as version 2. Your old version is kept. The checker says (it never blocks):");
    await expect(page.locator(".ccs-say.show")).toContainText("Chris's rules (Part 0) ban \"your number\". Saved anyway, because a person wrote it.");
    const [p] = posts(calls, "POST marketing/scripts/edit");
    const ex = CONTRACT["POST marketing/scripts/edit"].example.request;
    expect(p.body.body).toBe(ex.body);
    expect(p.body.parts).toEqual(ex.parts);
    expect(p.body.version).toBe(1);
    await expect(card(page)).toContainText("version 2");
  });

  test("a stale Edit shows both texts; Use mine saves on the live version", async ({ page }) => {
    const a = api();
    let first = true;
    const realEdit = a.routes["POST marketing/scripts/edit"];
    a.routes["POST marketing/scripts/edit"] = (req) => {
      if (first) {
        first = false;
        const live = { ...a.db.scripts[0], id: "00000000-0000-4000-8000-000000000105", version: 2, body: "Someone else's words." };
        a.db.scripts = a.db.scripts.map((x) => (x.root_script_id === live.root_script_id ? live : x));
        return [409, { error: "stale", message: "This script changed.", current: { version: 2, body: live.body, parts: live.parts } }];
      }
      return realEdit(req);
    };
    const calls = await open(page, a);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Call to action").fill("Tap below and see your number today.");
    await page.getByRole("button", { name: "Save new version" }).click();

    const conflict = page.locator(".ccs-conflict");
    await expect(conflict).toContainText("This script changed since you opened it.");
    await expect(conflict).toContainText("Someone else's words.");
    await expect(conflict).toContainText("Tap below and see your number today.");
    await conflict.getByRole("button", { name: "Use mine" }).click();
    await expect(page.locator(".ccs-say.show")).toContainText("Saved as version 3.");
    const edits = posts(calls, "POST marketing/scripts/edit");
    expect(edits).toHaveLength(2);
    expect(edits[1].body.id).toBe("00000000-0000-4000-8000-000000000105");
    expect(edits[1].body.version).toBe(2);
    expect(edits[1].body.request_id).not.toBe(edits[0].body.request_id);
  });

  test("Fix: a note and 'Make this a rule', the cost sheet first, the new version back within 5 seconds", async ({ page }) => {
    const a = api();
    const calls = await open(page, a);
    await page.getByRole("button", { name: "Fix" }).click();
    await expect(card(page)).toContainText("One rewrite, about the cost of one script. Cost: unknown, not measured yet.");
    await page.getByLabel("What should change?").fill("Make the hook about the business file, not the personal one.");
    await page.getByLabel("Make this a rule for every script").check();
    await page.getByRole("button", { name: "Rewrite it" }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Rewrite this script from your note");
    await expect(sheet).toContainText("Cost: unknown, not measured yet.");
    expect(posts(calls, "POST marketing/scripts/fix")).toHaveLength(0);
    await sheet.getByRole("button", { name: "Yes, go ahead" }).click();

    await expect(page.locator(".ccs-say.show")).toContainText("Rewriting from your note. It comes back here when done.");
    await expect(page.locator(".ccs-say.show")).toContainText("Your note is also saved as a new rule for every script.");
    const [p] = posts(calls, "POST marketing/scripts/fix");
    expect(p.body).toMatchObject({ id: "00000000-0000-4000-8000-000000000201", version: 1, note: "Make the hook about the business file, not the personal one.", make_rule: true });
    expect(page.getByRole("heading", { name: "2 scripts waiting for you" })).toBeVisible();
    await expect(card(page)).toContainText("Draft 1 of 2 · Roadmap $147"); // the rewriting card went to the end

    // The writer saves version 2; the tab picks it up on its next 5-second look.
    const old = a.db.scripts.find((x) => x.id === "00000000-0000-4000-8000-000000000201");
    a.db.scripts = a.db.scripts.map((x) => (x === old ? { ...old, id: "00000000-0000-4000-8000-000000000202", version: 2, flagged: false, check_results: null, fix_note: p.body.note } : x));
    await page.clock.runFor(5000);
    await expect(page.locator(".ccs-say.show")).toContainText("\"Inquiries off first\" was rewritten from your note. Version 2 is in your drafts.");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(card(page)).toContainText("Draft 2 of 2 · Book a call · sorting hat short · version 2");
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  });

  test("Reject takes two taps, names what happens, and Keep it backs out", async ({ page }) => {
    const calls = await open(page);
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(card(page)).toContainText("Reject this script? It will not be filmed, and it leaves your drafts.");
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
    expect(posts(calls, "POST marketing/scripts/reject")).toHaveLength(0);

    const reject = page.getByRole("button", { name: "Reject", exact: true });
    const approveBox = await page.getByRole("button", { name: "Approve", exact: true }).boundingBox();
    const rejectBox = await reject.boundingBox();
    expect(rejectBox.y - (approveBox.y + approveBox.height)).toBeGreaterThanOrEqual(32);
    await reject.click();
    await page.getByLabel("Why? (optional)").fill("Too close to Ad 84.");
    await page.getByRole("button", { name: "Reject it" }).click();
    await expect(page.locator(".ccs-say.show")).toContainText("Rejected. It will not be filmed.");
    const [p] = posts(calls, "POST marketing/scripts/reject");
    expect(p.body).toMatchObject({ id: "00000000-0000-4000-8000-000000000201", version: 1, reason: "Too close to Ad 84." });
    await expect(page.getByRole("heading", { name: "1 script waiting for you" })).toBeVisible();
  });

  test("film order: Film first and the arrows send the root ids in order", async ({ page }) => {
    const calls = await open(page, api(), { param: "approved" });
    await expect(page.getByRole("heading", { name: "2 approved scripts to film" })).toBeVisible();
    const rows = page.locator(".ccs-row");
    await expect(rows.nth(0)).toContainText("Ad 91");
    await expect(rows.nth(0)).toContainText("Films first");
    await page.getByRole("button", { name: "Film Ad 92 first" }).click();
    await expect(page.locator(".ccs-say.show")).toContainText("Film order saved.");
    await expect(rows.nth(0)).toContainText("Ad 92");
    await expect(rows.nth(0)).toContainText("Film order 1");
    await page.getByRole("button", { name: "Film Ad 92 later" }).click();
    await expect(rows.nth(0)).toContainText("Ad 91");
    const orders = posts(calls, "POST marketing/scripts/order").map((c) => c.body.order);
    expect(orders).toEqual([[R92, R91], [R91, R92]]);
  });

  test("Write now is not drawn while write_now_ready is false", async ({ page }) => {
    const a = api({ "GET marketing/batches": () => [200, { batches: [], write_now_ready: false }] });
    await open(page, a);
    await expect(page.getByRole("heading", { name: "2 scripts waiting for you" })).toBeVisible();
    await page.getByText("Ideas", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Save idea" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Write/ })).toHaveCount(0);
  });

  test("Write now: a plain cost note, the cost sheet, then it says it is writing", async ({ page }) => {
    const calls = await open(page);
    const note = page.locator(".ccs-writenow .caption").first();
    await expect(note).toHaveText("Writes 3 scripts with the model. Cost and time: unknown, not measured yet. Stops by itself at $40 a batch and $300 a month.");
    await page.getByRole("button", { name: "Write now" }).click();
    expect(posts(calls, "POST marketing/batches/write-now")).toHaveLength(0);
    await page.getByRole("dialog").getByRole("button", { name: "Yes, go ahead" }).click();
    await expect(page.locator(".ccs-writenow .ccs-say.show")).toContainText("Writing now. New drafts show up here when they are done.");
    const [p] = posts(calls, "POST marketing/batches/write-now");
    expect(p.body.request_id).toMatch(UUID);
  });

  test("an idea: the big box, optional format and funnel, Save, and Write it now behind the cost sheet", async ({ page }) => {
    const calls = await open(page);
    await page.getByText("Ideas", { exact: true }).click();
    await page.getByLabel("Your idea").fill("Banks read the business file first.");
    await page.getByLabel("Format (optional)").selectOption("sorting");
    await page.getByLabel("Funnel (optional)").selectOption("book_call");
    await page.getByRole("button", { name: "Save idea" }).click();
    await expect(page.locator(".ccs-say.show")).toContainText("Saved. It goes in the next batch.");
    await expect(page.locator(".ccs-idea").first()).toContainText("Banks read the business file first.");
    await expect(page.getByLabel("Your idea")).toHaveValue("");
    const [p] = posts(calls, "POST marketing/ideas");
    expect(p.body).toMatchObject({ raw_points: "Banks read the business file first.", script_format: "sorting", funnel_key: "book_call" });
    expect(p.body.write_now).toBeUndefined();

    await page.getByLabel("Your idea").fill("Rates are going up.");
    await page.getByRole("button", { name: "Write it now" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Yes, go ahead" }).click();
    await expect(page.locator(".ccs-say.show")).toContainText("Saved. Writing one script from it now.");
    expect(posts(calls, "POST marketing/ideas")[1].body.write_now).toBe(true);
  });

  test("rules: Part 0, add a rule, and its repo state turns to 'In the repo' within 5 seconds", async ({ page }) => {
    const a = api();
    const calls = await open(page, a);
    await page.getByText("Rules", { exact: true }).click();
    await expect(page.locator(".ccs-rule").first()).toContainText("Chris's word beats every rule below.");
    await expect(page.locator(".ccs-banned")).toContainText("game changer");
    await page.getByLabel("Add a rule").fill("Never say round two.");
    await page.getByRole("button", { name: "Add the rule" }).click();
    await expect(page.locator(".ccs-say.show")).toContainText("Saved. The next batch follows it.");
    const recent = page.locator(".ccs-recent li").first();
    await expect(recent).toContainText("Never say round two.");
    await expect(recent).toContainText("Reaching the repo");
    expect(posts(calls, "POST marketing/rules")[0].body).toMatchObject({ action: "add", text: "Never say round two." });

    a.db.rules = { ...a.db.rules, recent: a.db.rules.recent.map((r, i) => (i === 0 ? { ...r, state: "committed", committed_sha: "abcdef1234567" } : r)) };
    await page.clock.runFor(5000);
    await expect(recent).toContainText("In the repo");
    await expect(recent).toContainText("commit abcdef1");

    await page.getByRole("button", { name: "Change rule 1" }).click();
    await page.getByLabel("Rule 1").fill("Never write credit repair.");
    await page.getByRole("button", { name: "Save the rule" }).click();
    await expect(page.locator(".ccs-say.show")).toContainText("Saved. The next batch follows it.");
    expect(posts(calls, "POST marketing/rules")[1].body).toMatchObject({ action: "edit", n: 1, text: "Never write credit repair." });

    await page.getByLabel("Ban a phrase").fill("no brainer");
    await page.getByRole("button", { name: "Ban the phrase" }).click();
    await expect(page.locator(".ccs-say.show")).toContainText("No script may say that phrase.");
    expect(posts(calls, "POST marketing/rules")[2].body).toMatchObject({ action: "ban", text: "no brainer" });
  });

  test("every version and its checks unfold on the card", async ({ page }) => {
    const calls = await open(page);
    await page.getByText("Every version and its checks").click();
    const v = page.locator(".ccs-version");
    await expect(v).toHaveCount(2);
    await expect(v.first()).toContainText("Version 2 · draft · written by the machine");
    await expect(v.first()).toContainText("Rule checker: passed");
    await expect(v.nth(1)).toContainText("Version 1 · replaced");
    expect(calls.find((c) => c.key === "GET marketing/script").query.id).toBe("00000000-0000-4000-8000-000000000201");
  });

  test("a swipe moves between cards and never saves", async ({ page }) => {
    const calls = await open(page);
    await expect(card(page)).toContainText("Draft 1 of 2 · Book a call");
    await expect(page.locator(".ccs-writenow")).toBeVisible();
    await card(page).locator(".ccs-words").scrollIntoViewIfNeeded();
    const box = await card(page).locator(".ccs-words").boundingBox();
    await page.mouse.move(box.x + box.width - 16, box.y + 24);
    await page.mouse.down();
    await page.mouse.move(box.x + 16, box.y + 28, { steps: 6 });
    await page.mouse.up();
    await expect(card(page)).toContainText("Draft 2 of 2");
    expect(calls.filter((c) => c.key.startsWith("POST"))).toHaveLength(0);
  });

  test("loading, an error in one part, and the empty inbox", async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const a = api({
      "GET marketing/scripts": async () => { await gate; return [500, { error: "internal_error" }]; },
      "GET marketing/ideas": () => [200, { ideas: [] }]
    });
    await open(page, a);
    await expect(page.locator(".ccs-skels").first()).toBeVisible();
    release();
    await expect(page.locator(".ccs-err")).toContainText("The scripts did not load. Something broke on our side. Nothing changed. Try again. The rest of this tab is current.");
    await expect(page.locator(".ccs-err")).not.toContainText("500");
    await expect(page.getByRole("button", { name: "Write now" })).toBeVisible();

    a.routes["GET marketing/scripts"] = () => [200, { scripts: [], as_of: NOW }];
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(".ccs-empty")).toContainText("No scripts waiting for you.");
    await expect(page.locator(".ccs-empty")).toContainText("The weekly drop is off. It turns on in Settings (the gear, top right).");
    await page.getByText("Ideas", { exact: true }).click();
    await expect(page.getByText("No ideas yet. Type or say one above. It goes in the next batch.")).toBeVisible();
  });

  test("one column, no sideways scroll, text 11px or larger, taps 40px or larger", async ({ page }) => {
    await open(page);
    await page.getByText("Ideas", { exact: true }).click();
    await page.getByText("Rules", { exact: true }).click();
    await page.getByText("Batch history", { exact: true }).click();
    await expect(page.locator(".ccs-rule").first()).toBeVisible();
    const m = await page.evaluate(() => {
      const root = document.querySelector(".ccs");
      const small = [];
      for (const el of root.querySelectorAll("*")) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own || !el.getClientRects().length) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 11) small.push(`${el.tagName}.${el.className}: ${fs}`);
      }
      const tiny = [];
      for (const b of root.querySelectorAll("button, summary, select, textarea, input")) {
        const r = b.getBoundingClientRect();
        if (!r.width) continue;
        if (r.height < 40) tiny.push(`${b.tagName} ${b.textContent.trim().slice(0, 20)}: ${r.height}`);
      }
      return { scroll: document.documentElement.scrollWidth, width: window.innerWidth, small, tiny };
    });
    expect(m.scroll).toBeLessThanOrEqual(m.width);
    expect(m.small).toEqual([]);
    expect(m.tiny).toEqual([]);
  });

  test("polls only while the tab is on screen", async ({ page }) => {
    const calls = await open(page);
    await expect(page.getByRole("heading", { name: "2 scripts waiting for you" })).toBeVisible();
    // The contract's newest batch is writing, so the tab looks again every 5 seconds.
    const before = calls.filter((c) => c.key === "GET marketing/batches").length;
    await page.clock.runFor(5000);
    await expect.poll(() => calls.filter((c) => c.key === "GET marketing/batches").length).toBeGreaterThan(before);
    await page.evaluate(() => window.__stub.hide());
    const after = calls.length;
    await page.clock.runFor(15000);
    expect(calls.length).toBe(after);
  });
});

/* ── the same tab on a laptop ─────────────────────────────────────────────── */

test.describe("Scripts tab on a laptop (1280x900)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the card, the actions and the folds fit with no sideways scroll; Approve works", async ({ page }) => {
    const calls = await open(page);
    await expect(card(page)).toContainText("Draft 1 of 2");
    const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    expect(m.scroll).toBeLessThanOrEqual(m.width);
    const approve = await page.getByRole("button", { name: "Approve", exact: true }).boundingBox();
    expect(approve.y + approve.height).toBeLessThan(900 * 2); // reachable without hunting
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.locator(".ccs-say.show")).toContainText("Approved. This is Ad 93.");
    expect(posts(calls, "POST marketing/scripts/approve")).toHaveLength(1);
  });
});
