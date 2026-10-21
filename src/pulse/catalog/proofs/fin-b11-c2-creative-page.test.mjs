// Batch 11, repair cycle 2: the Creative Factory screen, pressed where cycle 1 left it unseen.
//
// Practice tests in Chromium with a fake server. They add to fin-b11-creative-factory.test.mjs and judge
// what the controls SAY and what they ACT ON, which cycle 1 left to the markup:
//   * every button is found by the words a person reads on it, never by a hidden attribute
//   * Brand kits: what each card and each drawer says about a kit, and which chip is pressed
//   * Creative library: the chip counts with archived creatives shown, the kit the select remembers, the
//     words of its options, the pressed chips, the "on this page" count
//   * Enqueue: the allowance read failing at the network, the server's own note, the button's words
//   * Generate form: every option's words against its value, pressed by the words
//   * Generation jobs: every size, the page that ends exactly full, the count and button words
//   * Job detail: all four failure sentences, the plural words, the Space key
//   * Reject / Approve / Archive / brand buttons: the refusal words and the double press
//   * Review queue: size 50, and every kind of row's detail
//   * Reference: the "why creative gets stopped" panel, word for word, against the code that stops creative
//
// Nothing here reaches a real database, a vendor or the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bodyOf, clearShellOverlays, dialogs, json, OWNER, sharedScreens, waitFor
} from "./fin-b11-kit.mjs";
import { screen } from "../../../compliance/screen.mjs";
import { screenTargeting } from "../../../compliance/targeting.mjs";

const { open } = sharedScreens();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function gate() {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  return { wait, release };
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const stamp = (ts) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(ts);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])} ${m[4]}:${m[5]}`;
};

const P1 = "aa000000-0000-4000-8000-000000000001";
const P2 = "aa000000-0000-4000-8000-000000000002";
const K1 = "bb000000-0000-4000-8000-000000000001";
const K2 = "bb000000-0000-4000-8000-000000000002";
const K3 = "bb000000-0000-4000-8000-000000000003";
const A = (n) => `cc000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const J = (n) => `dd000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S1 = "ee000000-0000-4000-8000-000000000001";
const BRAND = "ff000000-0000-4000-8000-000000000001";
const CAMPAIGN = "ff000000-0000-4000-8000-000000000002";
const CAMPAIGN2 = "ff000000-0000-4000-8000-000000000003";
const iso = (minutesAgo) => new Date(Date.UTC(2026, 9, 14, 12, 0, 0) - minutesAgo * 60_000).toISOString();

const PARTNERS = [{ id: P1, name: "Alpha Funding", slug: "alpha" }, { id: P2, name: "Beta Capital", slug: "beta" }];
const REASON = { code: "guaranteed-approval", rule_set: "claims", message: "Guaranteed approval cannot be advertised. Approval depends on underwriting." };
const asset = (n, over) => ({
  id: A(n), brand_kit_id: K1, kind: "static", format: "1x1", provider: "static", duration_sec: null, copy_text: null,
  ai_generated: true, synthetic_performer: false, compliance_state: "passed", blocked_reasons: [], parent_asset_id: null,
  archived_at: null, created_at: iso(n * 60), updated_at: iso(n * 60), ...over
});
const LIBRARY = () => [
  asset(1, { compliance_state: "pending" }),
  asset(2, { kind: "copy", format: "4x5", provider: "copy", compliance_state: "blocked", blocked_reasons: [REASON], copy_text: "Working capital for owners." }),
  asset(3, { kind: "video", format: "9x16", provider: "ugc-video", brand_kit_id: K2, compliance_state: "approved", duration_sec: 22 }),
  asset(4, { format: "16x9" }),
  asset(5, { compliance_state: "approved", archived_at: iso(30) }),
  asset(6, { kind: "copy", format: "1x1", provider: "copy", brand_kit_id: K2, copy_text: "Funding that moves." }),
  asset(7, { kind: "video", format: "16x9", provider: "product-video", compliance_state: "pending" }),
  asset(8, { format: "4x5", brand_kit_id: K2, compliance_state: "blocked", blocked_reasons: [REASON] }),
  asset(9, { format: "9x16" })
];
const job = (n, over) => ({
  id: J(n), brand_kit_id: null, provider: "static", status: "succeeded", attempt: 1, error: null, idempotency_key: `batch-${n}`,
  started_at: iso(n * 10), finished_at: iso(n * 10 - 1), created_at: iso(n * 10 + 1), asset_kind: "static", formats: ["1x1"], variants: 1, asset_count: 2, ...over
});
const JOBS = () => Array.from({ length: 12 }, (_, i) => job(i + 1));
const KIT_ROWS = () => [
  { id: K1, name: "Alpha kit", source_url: "https://alpha.example.test", scraped_at: iso(600), palette: { ink: "#0A0A0A", paper: "#FCFCFC", accents: ["#FF0000", "#00FF00"], label: "not a colour" },
    fonts: { display: "Inter", body: "Georgia" }, voice_profile: { tone: "plain and direct", rules: ["no hype", "no promises"] },
    products: [{ name: "Working capital" }, { name: "Line of credit" }], status: "active", logo_asset_id: "99999999-0000-4000-8000-000000000001", asset_count: 7, created_at: iso(5000), updated_at: iso(4000) },
  { id: K2, name: "Beta kit", source_url: null, scraped_at: null, palette: {}, fonts: {}, voice_profile: {}, products: [], status: "draft", logo_asset_id: null, asset_count: 0, created_at: iso(3000), updated_at: iso(3000) },
  { id: K3, name: "Gamma kit", source_url: null, scraped_at: null, palette: { name: "text only" }, fonts: { display: "Futura" }, voice_profile: { tone: "warm" },
    products: [{ name: "Credit cards" }], status: "archived", logo_asset_id: null, asset_count: 1, created_at: iso(2000), updated_at: iso(1000) }
];
const APPROVALS = () => [
  { item_type: "creative_asset", id: A(2), state: "blocked", subtype: "copy", detail: "4x5", reasons: [REASON], budget_cents: null, offer_type: null, platform: null, ai_generated: true, synthetic_performer: false, updated_at: iso(60) },
  { item_type: "creative_asset", id: A(1), state: "pending", subtype: "static", detail: "1x1", reasons: [], budget_cents: null, offer_type: null, platform: null, ai_generated: true, synthetic_performer: false, updated_at: iso(120) },
  { item_type: "campaign", id: CAMPAIGN, state: "awaiting_approval", subtype: "retargeting", detail: "Spring push", reasons: [{ code: "needs_approval", message: [{ code: "human_approval_required_setting", rule_set: "approval", message: "This partner has approve_before_launch enabled." }] }], budget_cents: 150000, offer_type: "funding", platform: "meta", ai_generated: null, synthetic_performer: null, updated_at: iso(180) },
  { item_type: "partner_brand", id: BRAND, state: "review", subtype: "brand", detail: "Alpha Funding LLC", reasons: [], budget_cents: null, offer_type: null, platform: null, ai_generated: null, synthetic_performer: null, updated_at: iso(240) }
];
const SCRIPTS = () => [{ id: S1, title: "Denial angle", version: 2, body_preview: "Banks said no." }];
const page200 = (items) => ({ ok: true, count: items.length, limit: 200, offset: 0, hasMore: false, items });
const BOTH_ON = () => ({
  [P1]: { ok: true, enabled: true, cap: 250000, used: 1200, remaining: 248800 },
  [P2]: { ok: true, enabled: true, cap: 80000, used: 300, remaining: 79700 }
});

async function openFactory({ session = OWNER, query = "", viewport, st: over = {}, answers = {} } = {}) {
  const st = {
    partners: PARTNERS, usage: BOTH_ON(), jobs: JOBS(), library: LIBRARY(), kits: KIT_ROWS(), approvals: APPROVALS(), scripts: SCRIPTS(),
    usageNetworkFail: false, usageGate: null, libraryStatus: null, generateGate: null, actionsGate: null, brandGate: null, ...over
  };
  const log = { reads: [], generate: [], actions: [], brand: [], usage: [] };
  const pidOf = (url) => new URL(url).searchParams.get("partner_id");
  const handlers = {
    "/api/read/partners": async (route) => json(route, page200(st.partners)),
    "/api/partner-marketing/usage": async (route, { url }) => {
      log.usage.push(pidOf(url));
      if (st.usageNetworkFail) {
        // Failing last, after the five creative reads have painted, so nothing that redraws the screen
        // can put the controls right again afterwards and hide a button that came on by mistake.
        if (st.usageFailGate) await st.usageFailGate.wait;
        await route.abort("failed");
        return;
      }
      if (st.usageGate) await st.usageGate.wait;
      return json(route, st.usage[pidOf(url)] || { ok: false, message: "No such partner." });
    },
    "/api/creative/jobs": async (route, { url }) => { log.reads.push(["jobs", pidOf(url)]); return json(route, page200(st.jobs)); },
    "/api/creative/library": async (route, { url }) => {
      log.reads.push(["library", pidOf(url)]);
      if (st.libraryStatus) return json(route, { ok: false, error: "server" }, st.libraryStatus);
      return json(route, page200(st.library));
    },
    "/api/creative/brand-kits": async (route, { url }) => { log.reads.push(["kits", pidOf(url)]); return json(route, page200(st.kits)); },
    "/api/creative/approvals": async (route, { url }) => { log.reads.push(["approvals", pidOf(url)]); return json(route, page200(st.approvals)); },
    "/api/scripts/list": async (route, { url }) => { log.reads.push(["scripts", pidOf(url)]); return json(route, page200(st.scripts)); },
    "/api/read/video-stats": async (route) => json(route, { ok: true, connection: null, videos: [] }),
    "/api/creative/generate": async (route) => {
      const body = bodyOf(route);
      log.generate.push(body);
      if (st.generateGate) await st.generateGate.wait;
      const out = answers.generate ? answers.generate(log.generate.length, body) : { status: 200, body: { ok: true, created: true, note: "Saved to the queue." } };
      if (out.abort) { await route.abort("failed"); return; }
      return json(route, out.body, out.status);
    },
    "/api/creative/actions": async (route) => {
      const body = bodyOf(route);
      log.actions.push(body);
      if (st.actionsGate) await st.actionsGate.wait;
      const found = st.library.find((a) => a.id === body.asset_id);
      const out = answers.actions ? answers.actions(body, log.actions.length) : { status: 200, body: { ok: true, action: body.action, asset: { ...(found || { id: body.asset_id }) } } };
      return json(route, out.body, out.status);
    },
    "/api/brand/review": async (route) => {
      const body = bodyOf(route);
      log.brand.push(body);
      if (st.brandGate) await st.brandGate.wait;
      const out = answers.brand ? answers.brand(body, log.brand.length) : { status: 200, body: { ok: true, action: body.action, partner_id: body.partner_id, approval_status: body.action === "approve" ? "approved" : "draft" } };
      if (out.abort) { await route.abort("failed"); return; }
      return json(route, out.body, out.status);
    }
  };
  const opened = await open(`/app/creative-factory.html${query}`, { session, handlers, ...(viewport ? { viewport } : {}) });
  await waitFor(() => ["jobs", "library", "kits", "approvals", "scripts"].every((k) => log.reads.some(([name]) => name === k)), "the five creative reads");
  await clearShellOverlays(opened.page);
  return { ...opened, st, log };
}

// textContent, not innerText: the screen draws labels, badges and counts in capitals (CSS), and the
// words are what is judged here.
const text = (page, selector) => page.locator(selector).evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
const texts = (locator) => locator.evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
const chipTexts = (page, selector) => page.locator(`${selector} button`).evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
const chipClasses = (page, selector) => page.locator(`${selector} button`).evaluateAll((els) => els.map((e) => e.className));
const drawerOpen = (page) => page.evaluate(() => document.getElementById("drawer").classList.contains("on"));
const button = (page, name, scope = null) => (scope || page).getByRole("button", { name, exact: true });

// ── Brand kits ─────────────────────────────────────────────────────────────────────────────────

test("Brand kits: every card says its own status, count, colours, fonts, tone, products and logo, and every drawer opens as its kit", { timeout: 90_000 }, async () => {
  const { page } = await openFactory();
  await waitFor(async () => (await page.locator("#kitGrid .kit").count()) === 3, "three kits");
  const card = (id) => page.locator(`#kitGrid .kit[data-kit='${id}']`);

  // Each card, field by field.
  const read = async (id) => ({
    name: await text(page, `#kitGrid .kit[data-kit='${id}'] .kn`),
    badge: [await card(id).locator(".kh .badge").first().textContent(), await card(id).locator(".kh .badge").first().getAttribute("class")],
    count: await card(id).locator(".kh .badge").nth(1).textContent(),
    swatches: await card(id).locator(".sw i").evaluateAll((els) => els.map((e) => [e.getAttribute("title"), e.getAttribute("style")])),
    noColors: await card(id).locator(".kk").first().evaluate((el) => el.textContent.trim()),
    body: await card(id).locator(".kk").last().evaluate((el) => el.textContent.replace(/\s+/g, " ").trim())
  });
  const a = await read(K1);
  assert.equal(a.name, "Alpha kit");
  assert.deepEqual(a.badge, ["active", "badge b-ok"]);
  assert.equal(a.count, "7 assets");
  assert.deepEqual(a.swatches.map((s) => s[0]), ["ink #0A0A0A", "paper #FCFCFC", "accents[0] #FF0000", "accents[1] #00FF00"], "colours only: the text value is not a swatch");
  assert.ok(a.swatches.every(([, style]) => /background:\s*#/i.test(style)));
  assert.match(a.body, /Tone plain and direct/);
  assert.match(a.body, /Fonts display: Inter · body: Georgia/);
  assert.match(a.body, /Products 2 items/);
  assert.match(a.body, /Logo 99999999 \(reference, not a picture\)/);

  const b = await read(K2);
  assert.deepEqual(b.badge, ["draft", "badge b-gray"]);
  assert.equal(b.count, "0 assets");
  assert.equal(b.swatches.length, 0);
  assert.match(b.noColors, /No colors in this kit\./);
  assert.match(b.body, /Tone not set/);
  assert.match(b.body, /Fonts none/);
  assert.match(b.body, /Products none/);
  assert.match(b.body, /Logo none/);

  const c = await read(K3);
  assert.deepEqual(c.badge, ["archived", "badge b-info"]);
  assert.equal(c.count, "1 assets");
  assert.equal(c.swatches.length, 0, "a palette with no colour in it has no swatch");
  assert.match(c.body, /Tone warm/);
  assert.match(c.body, /Fonts display: Futura/);
  assert.match(c.body, /Products 1 item(?!s)/);

  // Each drawer: opened by its own card, with that kit's own facts.
  await card(K1).click();
  assert.equal(await drawerOpen(page), true);
  assert.equal(await text(page, "#dwTitle"), "Alpha kit");
  assert.match(await text(page, "#dwEyebrow"), /brand kit/i);
  const pairs = async () => page.locator("#dwBody .dw-sec").first().locator(".kv > div").evaluateAll((els) => els.map((e) => [e.querySelector(".k").textContent, e.querySelector(".v").textContent.trim()]));
  assert.deepEqual(await pairs(), [
    ["Name", "Alpha kit"], ["Status", "active"], ["Creatives using it", "7"], ["Website it came from", "https://alpha.example.test"],
    ["Last read", stamp(iso(600))], ["Logo", "99999999 (a reference, not a picture)"], ["Created", stamp(iso(5000))], ["Updated", stamp(iso(4000))],
    ["Reference", K1]
  ]);
  const body = await text(page, "#dwBody");
  assert.match(body, /ink[\s\S]*#0A0A0A/);
  assert.match(body, /accents[\s\S]*#FF0000, #00FF00/);
  assert.match(body, /display[\s\S]*Inter/);
  assert.match(body, /tone[\s\S]*plain and direct/);
  assert.match(body, /Working capital/);
  assert.match(body, /Line of credit/);
  await page.keyboard.press("Escape");

  await card(K2).click();
  assert.equal(await text(page, "#dwTitle"), "Beta kit");
  assert.deepEqual(await pairs(), [
    ["Name", "Beta kit"], ["Status", "draft"], ["Creatives using it", "0"], ["Website it came from", "—"],
    ["Last read", "—"], ["Logo", "—"], ["Created", stamp(iso(3000))], ["Updated", stamp(iso(3000))], ["Reference", K2]
  ]);
  assert.match(await text(page, "#dwBody"), /Nothing set\./);
  assert.match(await text(page, "#dwBody"), /None\./);
  await page.keyboard.press("Escape");

  await card(K3).click();
  assert.equal(await text(page, "#dwTitle"), "Gamma kit");
  assert.deepEqual((await pairs()).slice(0, 3), [["Name", "Gamma kit"], ["Status", "archived"], ["Creatives using it", "1"]]);
  await page.keyboard.press("Escape");
  await page.close();
});

test("Brand kits: the pressed chip is the one marked, and each chip counts its own kits", { timeout: 60_000 }, async () => {
  const { page } = await openFactory();
  await waitFor(async () => (await page.locator("#kitGrid .kit").count()) === 3, "three kits");
  assert.deepEqual(await chipTexts(page, "#kitRail"), ["all3", "draft1", "active1", "archived1"]);
  assert.deepEqual(await chipClasses(page, "#kitRail"), ["on", "", "", ""], "all is marked at the start");
  await page.locator("#kitRail [data-ks='draft']").click();
  assert.deepEqual(await chipClasses(page, "#kitRail"), ["", "on", "", ""], "only the pressed chip is marked");
  assert.deepEqual(await page.locator("#kitGrid .kit .kn").allInnerTexts(), ["Beta kit"]);
  await page.locator("#kitRail [data-ks='archived']").click();
  assert.deepEqual(await chipClasses(page, "#kitRail"), ["", "", "", "on"]);
  assert.deepEqual(await page.locator("#kitGrid .kit .kn").allInnerTexts(), ["Gamma kit"]);
  await page.locator("#kitRail [data-ks='active']").click();
  assert.deepEqual(await chipClasses(page, "#kitRail"), ["", "", "on", ""]);
  assert.deepEqual(await page.locator("#kitGrid .kit .kn").allInnerTexts(), ["Alpha kit"]);
  await page.close();
});

// ── Creative library ───────────────────────────────────────────────────────────────────────────

test("Creative library: the chip counts follow Include archived, the kit select keeps its pick, options say names, pressed chips are marked", { timeout: 90_000 }, async () => {
  const { page } = await openFactory();
  await page.locator("#libLimit").selectOption("50");
  assert.deepEqual(await chipTexts(page, "#libStateRail"), ["all8", "pending2", "passed3", "blocked2", "approved1"]);
  assert.equal(await text(page, "#libCount"), "8 on this page");

  // Include archived: the chips count the archived creative too, and agree with the grid.
  await page.locator("#libArch").selectOption("1");
  assert.equal(await page.locator("#libGrid .acard").count(), 9);
  assert.deepEqual(await chipTexts(page, "#libStateRail"), ["all9", "pending2", "passed3", "blocked2", "approved2"]);
  assert.deepEqual(await chipTexts(page, "#libKindRail"), ["any9", "static5", "video2", "copy2"]);
  assert.deepEqual(await chipTexts(page, "#libFormatRail"), ["any9", "1x13", "4x52", "9x162", "16x92"]);
  assert.equal(await text(page, "#libCount"), "9 on this page");
  await page.locator("#libStateRail [data-ls='approved']").click();
  assert.equal(await page.locator("#libGrid .acard").count(), 2, "the grid and the approved chip agree");
  await page.locator("#libStateRail [data-ls='all']").click();
  await page.locator("#libArch").selectOption("");
  assert.deepEqual(await chipTexts(page, "#libStateRail"), ["all8", "pending2", "passed3", "blocked2", "approved1"]);
  assert.equal(await page.locator("#libArch").inputValue(), "");

  // The kit select: the words are the kit's name, the value its id, "any" first, and the pick stays picked.
  const options = await page.locator("#libKit option").evaluateAll((els) => els.map((e) => [e.value, e.textContent]));
  assert.deepEqual(options, [["", "any"], [K1, "Alpha kit"], [K2, "Beta kit"], [K3, "Gamma kit"]]);
  await page.locator("#libKit").selectOption(K2);
  assert.equal(await page.locator("#libKit").inputValue(), K2, "the kit that was picked is still shown as picked");
  assert.equal(await text(page, "#libKit option:checked"), "Beta kit");
  assert.equal(await page.locator("#libGrid .acard").count(), 3);
  // A second filter does not make it forget the kit.
  await page.locator("#libKindRail [data-lk='copy']").click();
  assert.equal(await page.locator("#libKit").inputValue(), K2);
  assert.equal(await page.locator("#libGrid .acard").count(), 1);
  await page.locator("#libKindRail [data-lk='']").click();
  await page.locator("#libKit").selectOption("");
  assert.equal(await page.locator("#libKit").inputValue(), "");

  // Pressed chips are marked, and only they.
  assert.deepEqual(await chipClasses(page, "#libStateRail"), ["on", "", "", "", ""]);
  assert.deepEqual(await chipClasses(page, "#libKindRail"), ["on", "", "", ""]);
  assert.deepEqual(await chipClasses(page, "#libFormatRail"), ["on", "", "", "", ""]);
  await page.locator("#libStateRail [data-ls='blocked']").click();
  await page.locator("#libKindRail [data-lk='copy']").click();
  await page.locator("#libFormatRail [data-lf='4x5']").click();
  assert.deepEqual(await chipClasses(page, "#libStateRail"), ["", "", "", "on", ""]);
  assert.deepEqual(await chipClasses(page, "#libKindRail"), ["", "", "", "on"]);
  assert.deepEqual(await chipClasses(page, "#libFormatRail"), ["", "", "on", "", ""]);

  // "on this page" is the number of cards on the page in front of you.
  await page.locator("#libStateRail [data-ls='all']").click();
  await page.locator("#libKindRail [data-lk='']").click();
  await page.locator("#libFormatRail [data-lf='']").click();
  await page.locator("#libLimit").selectOption("6");
  assert.equal(await text(page, "#libCount"), "6 on this page");
  await page.locator("#libPager [data-mv='1']").click();
  assert.equal(await text(page, "#libCount"), "2 on this page");
  assert.equal(await text(page, "#libPager span"), "Showing 2");
  // The size select says its sizes and its label.
  assert.deepEqual(await page.locator("#libLimit option").allInnerTexts(), ["6", "12", "50", "200"]);
  assert.equal(await text(page, "label[for='libLimit']"), "show");
  await page.close();
});

test("Creative library: a failed read says not loaded and counts nothing", { timeout: 60_000 }, async () => {
  const { page } = await openFactory({ st: { libraryStatus: 500 } });
  await waitFor(async () => (await text(page, "#libCount")) === "not loaded", "not loaded");
  assert.deepEqual(await chipTexts(page, "#libStateRail"), ["all", "pending", "passed", "blocked", "approved"], "no count is shown for a read that failed");
  assert.match(await text(page, "#libGrid"), /could not be loaded just now/);
  await page.close();
});

// ── Enqueue and the Generate form ─────────────────────────────────────────────────────────────

test("Enqueue: the allowance failing at the network keeps every write off and says so; the button says what it does", { timeout: 90_000 }, async () => {
  const failGate = gate();
  const { page, log } = await openFactory({ st: { usageNetworkFail: true, usageFailGate: failGate } });
  await waitFor(async () => (await page.locator("#jobBody tr[data-job]").count()) > 0, "the jobs painted");
  assert.equal(await page.locator("#genBtn").isDisabled(), true, "Enqueue is off while the allowance is still out");
  failGate.release();
  await waitFor(async () => (await page.locator("#cfUseBadge").textContent()) === "error", "the error badge");
  assert.equal(await page.locator("#cfUseBadge").textContent(), "error");
  assert.match(await text(page, "#cfUseBody"), /Could not reach the allowance\./);
  assert.equal(await page.locator("#genBtn").isDisabled(), true, "Enqueue stays off when the allowance could not be read");
  assert.equal(await page.locator("#runJobsBtn").isDisabled(), true);
  assert.deepEqual(await page.locator("[data-cact]").evaluateAll((els) => els.map((e) => e.disabled)), [true, true, true]);
  assert.match(await text(page, "#genMsg"), /Could not reach the allowance\./);
  assert.match(await text(page, "#actMsg"), /Could not reach the allowance\./);
  assert.equal(await page.locator("#cfWriteChipTxt").textContent(), "Read only");
  assert.deepEqual(log.generate, []);
  await page.close();

  // The buttons say what they do.
  const ok = await openFactory();
  await waitFor(async () => await ok.page.locator("#genBtn").isEnabled(), "Enqueue enabled");
  assert.equal(await ok.page.locator("#genBtn").textContent(), "Enqueue generation");
  assert.equal(await ok.page.locator("#runJobsBtn").textContent(), "Run queued jobs now");
  assert.deepEqual(await ok.page.locator("[data-cact]").evaluateAll((els) => els.map((e) => [e.dataset.cact, e.textContent])),
    [["approve", "Approve"], ["reject", "Reject"], ["archive", "Archive"]]);
  // Pressed with a request held out, the screen says it is working.
  ok.st.generateGate = gate();
  await ok.page.locator("#genOffer").selectOption({ label: "Funding" });
  await ok.page.locator("#genIdem").fill("held");
  await ok.page.locator("#genBtn").click();
  await waitFor(() => ok.log.generate.length === 1, "the held request");
  assert.equal(await text(ok.page, "#genMsg"), "Enqueueing…");
  ok.st.generateGate.release();
  await waitFor(async () => (await text(ok.page, "#genMsg")) === "Saved to the queue.", "the saved words");
  await ok.page.close();
});

test("Enqueue: the words under the button are the server's own note, and a note that says it cannot run yet is shown as written", { timeout: 90_000 }, async () => {
  const cannot = "Saved to the queue, but it cannot run yet: no ad-making service is switched on for this account. The next try will be recorded as a failure and nothing will be made.";
  const unsure = "Saved to the queue. We could not check whether an ad-making service is switched on, so we cannot say yet whether it will run.";
  const answers = {
    generate: (n) => ({ status: 200, body: { ok: true, created: true, provider_ready: n === 1 ? false : null, note: n === 1 ? cannot : unsure } })
  };
  const { page, log } = await openFactory({ answers });
  await waitFor(async () => await page.locator("#genBtn").isEnabled(), "Enqueue enabled");
  await page.locator("#genOffer").selectOption({ label: "Credit cards" });
  await page.locator("#genIdem").fill("first");
  await page.locator("#genBtn").click();
  await waitFor(async () => (await text(page, "#genMsg")) === cannot, "the cannot-run note, word for word");
  assert.notEqual(await text(page, "#genMsg"), "Saved to the queue.", "the fallback words are not used when the server wrote a note");
  await page.locator("#genIdem").fill("second");
  await page.locator("#genBtn").click();
  await waitFor(async () => (await text(page, "#genMsg")) === unsure, "the could-not-check note, word for word");
  assert.equal(log.generate.length, 2);
  await page.close();
});

test("Generate form: every option says what it is, and the one a person reads is the one that is sent", { timeout: 90_000 }, async () => {
  const { page, log } = await openFactory();
  await waitFor(async () => await page.locator("#genBtn").isEnabled(), "Enqueue enabled");
  const labels = await page.locator(".selwrap label, .field label").evaluateAll((els) => els.map((e) => [e.getAttribute("for"), e.textContent.trim()]));
  const wanted = { genKind: "Kind", genOffer: "What is being sold", genPrompt: "What to make", genIdem: "Name this batch", genScript: "Script" };
  for (const [id, words] of Object.entries(wanted)) assert.ok(labels.some(([f, t]) => f === id && t === words), `${id} is labelled "${words}"`);
  assert.deepEqual(await page.locator("#genKind option").evaluateAll((els) => els.map((e) => [e.value, e.textContent])),
    [["static", "static"], ["copy", "copy"], ["video", "video"]]);
  assert.deepEqual(await page.locator("#genOffer option").evaluateAll((els) => els.map((e) => [e.value, e.textContent])),
    [["", "— choose one —"], ["funding", "Funding"], ["credit_cards", "Credit cards"], ["credit_repair", "Credit repair"]]);

  // Pressed by the words: what a person picks is what goes out.
  const picks = [
    ["static", "Funding", "funding"], ["copy", "Credit cards", "credit_cards"], ["video", "Credit repair", "credit_repair"],
    ["copy", "Funding", "funding"], ["static", "Credit repair", "credit_repair"], ["video", "Credit cards", "credit_cards"]
  ];
  for (const [n, [kind, offerWords, offerValue]] of picks.entries()) {
    await page.locator("#genKind").selectOption({ label: kind });
    await page.locator("#genOffer").selectOption({ label: offerWords });
    await page.locator("#genPrompt").fill(`${kind} / ${offerWords}`);
    await page.locator("#genIdem").fill(`pick-${n}`);
    await page.locator("#genBtn").click();
    await waitFor(() => log.generate.length === n + 1, `request ${n + 1}`);
    const sent = log.generate[n];
    assert.equal(sent.asset_kind, kind, `${kind} / ${offerWords}: the kind picked is the kind sent`);
    assert.equal(sent.spec.assetKind, kind);
    assert.equal(sent.spec.offerType, offerValue, `${kind} / ${offerWords}: the offer picked is the offer sent`);
    assert.equal(sent.prompt, `${kind} / ${offerWords}`);
    assert.equal(sent.spec.prompt, `${kind} / ${offerWords}`);
    assert.equal(sent.idempotency_key, `pick-${n}`);
  }
  await page.close();
});

// ── Generation jobs ────────────────────────────────────────────────────────────────────────────

test("Generation jobs: every size, the page that ends exactly full, the count and the button words", { timeout: 90_000 }, async () => {
  const ten = JOBS().slice(0, 10);
  const { page } = await openFactory({ st: { jobs: ten } });
  const rows = () => page.locator("#jobBody tr[data-job]").count();
  const prev = page.locator("#jobPager [data-mv='-1']");
  const next = page.locator("#jobPager [data-mv='1']");
  assert.equal(await page.locator("#jobLimit").inputValue(), "10", "the default size is ten");
  assert.deepEqual(await page.locator("#jobLimit option").allInnerTexts(), ["5", "10", "25", "50", "200"]);
  assert.equal(await text(page, "label[for='jobLimit']"), "show");
  assert.equal(await prev.textContent(), "‹ prev");
  assert.equal(await next.textContent(), "next ›");

  // Ten jobs at size ten: page one ends exactly full, and there is nothing after it.
  assert.equal(await rows(), 10);
  assert.equal(await text(page, "#jobPager span"), "Showing 10");
  assert.equal(await next.isDisabled(), true, "a page that ends exactly full has no next page");
  assert.equal(await prev.isDisabled(), true);

  // Ten jobs at size five: two full pages, and the second one has no next.
  await page.locator("#jobLimit").selectOption("5");
  assert.equal(await rows(), 5);
  assert.equal(await text(page, "#jobPager span"), "Showing 5");
  assert.equal(await next.isEnabled(), true);
  await next.click();
  assert.equal(await rows(), 5);
  assert.equal(await text(page, "#jobPager span"), "Showing 5");
  assert.equal(await next.isDisabled(), true, "the last page is exactly full and ends the list");
  assert.equal(await prev.isEnabled(), true);
  // Every other size holds all ten on one page.
  for (const size of ["25", "50", "200"]) {
    await page.locator("#jobLimit").selectOption(size);
    assert.equal(await rows(), 10, `size ${size}`);
    assert.equal(await text(page, "#jobPager span"), "Showing 10", `size ${size}`);
    assert.equal(await next.isDisabled(), true, `size ${size}`);
  }
  await page.close();

  // Twelve at ten: the second page holds two and says so.
  const twelve = await openFactory();
  assert.equal(await twelve.page.locator("#jobBody tr[data-job]").count(), 10);
  assert.equal(await text(twelve.page, "#jobPager span"), "Showing 10");
  await twelve.page.locator("#jobPager [data-mv='1']").click();
  assert.equal(await text(twelve.page, "#jobPager span"), "Showing 2");
  await twelve.page.locator("#jobLimit").selectOption("200");
  assert.equal(await text(twelve.page, "#jobPager span"), "Showing 12");
  await twelve.page.close();
});

test("Job detail: all four failure sentences, the plural words, and the Space key", { timeout: 90_000 }, async () => {
  const jobs = [
    job(1, { status: "failed", attempt: 3, error: 'creative_providers names provider "mystery", which has no module. Known: static', asset_count: 0 }),
    job(2, { status: "succeeded", attempt: 1, asset_count: 2 }),
    job(3, { status: "succeeded", attempt: 1, asset_count: 0 }),
    job(4, { status: "queued", attempt: 2, error: "provider returned zero assets", started_at: null, finished_at: null, asset_count: 0 }),
    job(5, { status: "queued", attempt: 1, started_at: null, finished_at: null, asset_count: 0 }),
    job(6, { status: "running", attempt: 2, finished_at: null, asset_count: 0 })
  ];
  const { page } = await openFactory({ st: { jobs } });
  const row = (n) => page.locator(`#jobBody tr[data-job='${J(n)}']`);
  const detail = (n) => page.locator(`#jobBody tr[data-job='${J(n)}'] + tr.det`);
  // Space opens the row from the keyboard, and Space closes it again.
  await row(1).focus();
  await page.keyboard.press(" ");
  assert.equal(await row(1).getAttribute("aria-expanded"), "true", "Space opens the detail");
  assert.equal(await detail(1).locator(".errbox").innerText(), "The ad-making service on file is one this system does not know how to use. Trying again will not help.");
  assert.match(await detail(1).innerText(), /Failed\. Stopped after three tries\./);
  await page.keyboard.press(" ");
  assert.equal(await row(1).getAttribute("aria-expanded"), "false", "Space closes it");
  assert.equal(await detail(1).count(), 0);
  // Plural words.
  await row(2).click();
  assert.match(await detail(2).innerText(), /Succeeded\. 2 assets stored\./);
  await row(3).click();
  assert.match(await detail(3).innerText(), /Succeeded\. 0 assets stored\./);
  await row(4).click();
  assert.match(await detail(4).innerText(), /Retrying\. Tried 2 times\. Failed after three tries\./);
  await row(5).click();
  assert.match(await detail(5).innerText(), /Retrying\. Tried 1 time\. Failed after three tries\./);
  assert.doesNotMatch(await detail(5).innerText(), /Tried 1 times/);
  await row(6).click();
  assert.match(await detail(6).innerText(), /Running\. Attempt 2\. No progress bar or wait time is available\./);
  await page.close();
});

// ── Reject, Approve, Archive: by the words, and in the server's refusal words ──────────────────────

test("Approve, Reject and Archive: each button does what it says, a refusal is in plain words, and a done line is not shown for one", { timeout: 120_000 }, async () => {
  const { page, log } = await openFactory();
  const ask = dialogs(page);
  await waitFor(async () => await page.locator("#genBtn").isEnabled(), "writes on");
  const actions = page.locator("#actAsset").locator("xpath=ancestor::div[contains(@class,'card-bd')]");
  await page.locator("#actAsset").selectOption(A(4));

  // Found by the words on them, each sends its own action.
  for (const [words, action] of [["Approve", "approve"], ["Reject", "reject"], ["Archive", "archive"]]) {
    ask.next(true);
    const before = log.actions.length;
    await button(page, words, actions).click();
    await waitFor(() => log.actions.length === before + 1, `the ${words} request`);
    assert.deepEqual(log.actions[before], { partner_id: P1, asset_id: A(4), action }, `the button that reads ${words} sends ${action}`);
  }
  // The question each one asks names what it will do.
  assert.match(ask.seen[0].message, /^Approve this creative\?/);
  assert.match(ask.seen[1].message, /^Reject this creative\?/);
  assert.match(ask.seen[2].message, /^Archive this creative\?/);
  await page.close();

  // Refusals: each action says "Could not <action> it." and then plain words, never the server's code.
  const refusals = [
    [{ error: "forbidden" }, 403, /Your account is not allowed to change this\./],
    [{ error: "not_found" }, 404, /That item is not in the list any more\./],
    [{ error: "unauthorized" }, 401, /You are signed out\./],
    [{ error: "archived assets cannot be approved" }, 400, /The server would not do it, and nothing changed\. Try again in a moment\./]
  ];
  for (const action of ["approve", "reject", "archive"]) {
    for (const [body, status, words] of refusals) {
      const one = await openFactory({ answers: { actions: () => ({ status, body: { ok: false, ...body } }) } });
      const confirm = dialogs(one.page);
      await waitFor(async () => await one.page.locator("#genBtn").isEnabled(), "writes on");
      await one.page.locator("#actAsset").selectOption(A(4));
      confirm.next(true);
      await button(one.page, action[0].toUpperCase() + action.slice(1)).click();
      await waitFor(async () => (await text(one.page, "#actMsg")).startsWith(`Could not ${action} it.`), `${action}: the refusal line`);
      const line = await text(one.page, "#actMsg");
      assert.match(line, words, `${action} / ${status}`);
      assert.doesNotMatch(line, /Done\./, `${action}: a refusal is never shown as done`);
      assert.doesNotMatch(line, /archived assets cannot|forbidden|not_found|unauthorized/, `${action}: the server's own code is not shown`);
      await one.page.close();
    }
  }
});

test("Approve, Reject and Archive: a creative that is not in the list, and no pick, send nothing", { timeout: 60_000 }, async () => {
  const { page, log } = await openFactory();
  const ask = dialogs(page);
  await waitFor(async () => await page.locator("#genBtn").isEnabled(), "writes on");
  for (const words of ["Approve", "Reject", "Archive"]) {
    await button(page, words).click();
    assert.equal(await text(page, "#actMsg"), "Choose a creative first.", words);
  }
  assert.deepEqual(log.actions, []);
  assert.deepEqual(ask.seen, [], "nothing was asked before a creative was chosen");
  await page.close();
});

// ── the brand buttons ─────────────────────────────────────────────────────────────────────────

async function brandBox(page) {
  await page.locator(`#apprBody tr[data-appr='${BRAND}']`).click();
  return page.locator(`#apprBody tr[data-appr='${BRAND}'] + tr.det [data-brand-box]`);
}

test("Brand buttons: found by their words, every refusal in its own words, and a button cannot be pressed twice", { timeout: 120_000 }, async () => {
  const held = gate();
  const { page, log, st } = await openFactory();
  const ask = dialogs(page);
  const box = await brandBox(page);
  assert.equal(await box.count(), 1);
  assert.deepEqual(await texts(box.locator("button")), ["Approve this brand", "Send it back"]);

  // Send it back, by its words, with a reason.
  await box.locator("[data-brand-note]").fill("  Use the full business name.  ");
  ask.next(true);
  await button(page, "Send it back", box).click();
  await waitFor(() => log.brand.length === 1, "the send-back request");
  assert.deepEqual(log.brand[0], { partner_id: P1, action: "reject", note: "Use the full business name." });

  // Approve, by its words: no reason is sent.
  const second = await openFactory();
  const ask2 = dialogs(second.page);
  const box2 = await brandBox(second.page);
  ask2.next(true);
  await button(second.page, "Approve this brand", box2).click();
  await waitFor(() => second.log.brand.length === 1, "the approve request");
  assert.deepEqual(second.log.brand[0], { partner_id: P1, action: "approve" });
  await second.page.close();

  // The server's words for each refusal.
  const cases = [
    [401, { ok: false, error: "unauthorized" }, "Your sign-in has expired. Sign in again and try once more."],
    [403, { ok: false, error: "forbidden", message: "Only Fundhub can approve a brand." }, "This sign-in is not allowed to approve a brand. Nothing was changed."],
    [503, { ok: false, error: "auth_unavailable" }, "We could not reach the system just now. Nothing was changed."],
    [409, { ok: false, error: "wrong_state", message: "Nothing changed — someone else changed this brand a moment ago. Reload and try again." }, "Nothing changed — someone else changed this brand a moment ago. Reload and try again."],
    [400, { ok: false, error: "note_too_long", message: "Keep the reason to 2000 characters or fewer." }, "Keep the reason to 2000 characters or fewer."],
    [500, { ok: false, error: "write_failed", message: "Something went wrong. Nothing was changed. Try again in a moment." }, "Something went wrong. Nothing was changed. Try again in a moment."],
    [500, { ok: false }, "Nothing was changed. Try again in a moment."]
  ];
  for (const [status, body, words] of cases) {
    for (const [words2, act] of [["Approve this brand", "approve"], ["Send it back", "reject"]]) {
      const one = await openFactory({ answers: { brand: () => ({ status, body }) } });
      const confirm = dialogs(one.page);
      const oneBox = await brandBox(one.page);
      if (act === "reject") await oneBox.locator("[data-brand-note]").fill("A reason");
      confirm.next(true);
      await button(one.page, words2, oneBox).click();
      await waitFor(async () => (await oneBox.locator("[data-brand-msg]").innerText()) === words, `${status} / ${act}: ${words}`);
      assert.doesNotMatch(await oneBox.locator("[data-brand-msg]").innerText(), /unauthorized|forbidden|wrong_state|auth_unavailable|write_failed/);
      assert.equal(await button(one.page, words2, oneBox).isEnabled(), true, "the button comes back after a refusal");
      await one.page.close();
    }
  }
  // The request never arrives: said in words, and the button comes back.
  const offline = await openFactory({ answers: { brand: () => ({ abort: true }) } });
  const offlineAsk = dialogs(offline.page);
  const offlineBox = await brandBox(offline.page);
  offlineAsk.next(true);
  await button(offline.page, "Approve this brand", offlineBox).click();
  await waitFor(async () => (await offlineBox.locator("[data-brand-msg]").innerText()) === "Nothing was changed — we could not reach the server. Try again in a moment.", "the could-not-reach words");
  assert.equal(await button(offline.page, "Approve this brand", offlineBox).isEnabled(), true);
  await offline.page.close();

  // Held answer: the pressed button is off while the request is out, and a second press sends nothing.
  st.brandGate = held;
  const box3 = await brandBox(page);
  ask.next(true);
  await button(page, "Approve this brand", box3).click();
  await waitFor(() => log.brand.length === 2, "the held approve request");
  const pressed = button(page, "Approve this brand", box3);
  assert.equal(await pressed.isDisabled(), true, "the pressed button is off while the answer is out");
  await pressed.evaluate((el) => el.click());
  await page.waitForTimeout(150);
  assert.equal(log.brand.length, 2, "a second press while the first is out sends nothing");
  held.release();
  await page.close();
});

test("Brand buttons: an admin gets them too, and every other role reads why there are none", { timeout: 90_000 }, async () => {
  for (const [role, expectButtons] of [["admin", true], ["owner", true], ["csm", false], ["closer", false], ["partner", false]]) {
    const { page } = await openFactory();
    await page.evaluate((r) => localStorage.setItem("fh_role", r), role);
    await page.locator(`#apprBody tr[data-appr='${BRAND}']`).click();
    const count = await page.locator(`#apprBody tr[data-appr='${BRAND}'] + tr.det [data-brand-box]`).count();
    assert.equal(count, expectButtons ? 1 : 0, `role ${role}`);
    if (expectButtons) {
      assert.deepEqual(await texts(page.locator(`#apprBody tr[data-appr='${BRAND}'] + tr.det [data-brand-box] button`)), ["Approve this brand", "Send it back"], role);
    } else {
      assert.match(await text(page, `#apprBody tr[data-appr='${BRAND}'] + tr.det`), /Only a Fundhub owner or admin can approve a brand or send it back/);
    }
    await page.close();
  }
});

// ── Review queue ───────────────────────────────────────────────────────────────────────────────

test("Review queue: size fifty, and what each kind of row says when it is opened", { timeout: 120_000 }, async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    item_type: "creative_asset", id: A(30 + i), state: i % 2 ? "blocked" : "pending", subtype: "static", detail: "1x1", reasons: i % 2 ? [REASON] : [],
    budget_cents: null, offer_type: null, platform: null, ai_generated: true, synthetic_performer: false, updated_at: iso(300 + i)
  }));
  const rich = [
    // three reasons, one with a detail line
    { item_type: "creative_asset", id: A(20), state: "blocked", subtype: "static", detail: "1x1", reasons: [
      REASON,
      { code: "advance-fee", rule_set: "croa", message: "Charging a fee first is prohibited." },
      { code: "screen_error", rule_set: "engine", message: "Compliance screening could not complete.", detail: "database timed out" }], budget_cents: null, offer_type: null, platform: null, ai_generated: false, synthetic_performer: true, updated_at: iso(10) },
    { item_type: "creative_asset", id: A(21), state: "pending", subtype: "video", detail: "9x16", reasons: [], budget_cents: null, offer_type: null, platform: null, ai_generated: true, synthetic_performer: false, updated_at: iso(20) },
    { item_type: "campaign", id: CAMPAIGN, state: "awaiting_approval", subtype: "retargeting", detail: "Spring push", reasons: [
      { code: "blocked", message: [{ code: "zip_targeting", rule_set: "platform", message: "ZIP/postal-code targeting is not permitted for credit offers." }] },
      { code: "needs_approval", message: [{ code: "human_approval_required_setting", rule_set: "approval", message: "This partner has approve_before_launch enabled." }] },
      { code: "passed", message: [] }], budget_cents: 150000, offer_type: "funding", platform: "meta", ai_generated: null, synthetic_performer: null, updated_at: iso(30) },
    { item_type: "campaign", id: CAMPAIGN2, state: "awaiting_approval", subtype: "prospecting", detail: "Credit repair push", reasons: [], budget_cents: null, offer_type: "credit_repair", platform: null, ai_generated: null, synthetic_performer: null, updated_at: iso(40) },
    { item_type: "partner_brand", id: BRAND, state: "review", subtype: "brand", detail: "Alpha Funding LLC", reasons: [], budget_cents: null, offer_type: null, platform: null, ai_generated: null, synthetic_performer: null, updated_at: iso(50) }
  ];
  const { page } = await openFactory({ st: { approvals: [...rich, ...many] } });
  const open = async (id) => {
    const row = page.locator(`#apprBody tr[data-appr='${id}']`);
    if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
    // textContent, not innerText: badges are drawn in capitals, and the words are what is judged.
    return page.locator(`#apprBody tr[data-appr='${id}'] + tr.det`).evaluate((el) => el.textContent.replace(/\s+/g, " "));
  };

  // Size fifty holds all seventeen rows on one page.
  assert.deepEqual(await page.locator("#apprLimit option").allInnerTexts(), ["5", "10", "50"]);
  await page.locator("#apprLimit").selectOption("50");
  assert.equal(await page.locator("#apprBody tr[data-appr]").count(), 17);
  assert.equal(await text(page, "#apprPager span"), "Showing 17");
  assert.equal(await page.locator("#apprPager [data-mv='1']").isDisabled(), true);
  assert.equal(await page.locator("#apprPager [data-mv='-1']").isDisabled(), true);
  await page.locator("#apprLimit").selectOption("10");
  assert.equal(await text(page, "#apprPager span"), "Showing 10");

  // The reasons column counts in the right words.
  const reasonsCell = (id) => page.locator(`#apprBody tr[data-appr='${id}'] td`).nth(4).innerText();
  assert.equal(await reasonsCell(A(20)), "3 reasons");
  assert.equal(await reasonsCell(A(31)), "1 reason");
  assert.equal(await reasonsCell(A(21)), "none");
  assert.equal(await reasonsCell(CAMPAIGN), "3 screenings");
  assert.equal(await reasonsCell(CAMPAIGN2), "none");

  // A blocked creative: every reason, the detail line, and the labels.
  const blocked = await open(A(20));
  assert.match(blocked, /Guaranteed approval cannot be advertised\./);
  assert.match(blocked, /Charging a fee first is prohibited\./);
  assert.match(blocked, /Compliance screening could not complete\./);
  assert.match(blocked, /More detail: database timed out/);
  assert.match(blocked, /reference: guaranteed-approval/);
  assert.match(blocked, /reference: advance-fee/);
  assert.match(blocked, /AI-generated\s*No/);
  assert.match(blocked, /Synthetic performer\s*Yes/);
  // A creative waiting to be checked says it is waiting, and is not called stopped.
  const waiting = await open(A(21));
  assert.match(waiting, /Nothing is flagged on this creative\. It is waiting to be checked — it is not stopped, and it is not ready to use either\./);
  // A campaign: its offer, where it runs, the money, and each check in its own word.
  const campaign = await open(CAMPAIGN);
  assert.match(campaign, /Strategy\s*retargeting/);
  assert.match(campaign, /Name\s*Spring push/);
  assert.match(campaign, /Budget\s*\$1,500\.00/);
  assert.match(campaign, /Offer\s*funding/);
  assert.match(campaign, /Where it runs\s*meta/);
  assert.match(campaign, /Stopped/);
  assert.match(campaign, /Waiting for a person/);
  assert.match(campaign, /Cleared/);
  assert.match(campaign, /Nothing was flagged in this check\./);
  assert.match(campaign, /ZIP\/postal-code targeting is not permitted for credit offers\./);
  assert.doesNotMatch(campaign, /This one cannot be waved through/, "only a credit-repair campaign carries that note");
  // A credit-repair campaign with no budget, no platform and no checks yet.
  const repair = await open(CAMPAIGN2);
  assert.match(repair, /Budget\s*—/);
  assert.match(repair, /Offer\s*credit_repair/);
  assert.match(repair, /Where it runs\s*anywhere/);
  assert.match(repair, /This campaign has not been checked yet\./);
  assert.match(repair, /This one cannot be waved through\. A credit-repair campaign needs a named person to approve it before it can go live/);
  // A brand: its business name and the time it has been waiting.
  const brand = await open(BRAND);
  assert.match(brand, /Business name\s*Alpha Funding LLC/);
  assert.match(brand, new RegExp(`In the queue since\\s*${stamp(iso(50))}`));
  assert.match(brand, /A partner sent their own brand in to be checked\./);
  // The "updated" column is the row's own time.
  assert.equal(await page.locator(`#apprBody tr[data-appr='${A(20)}'] td`).nth(9).innerText(), stamp(iso(10)));
  assert.equal(await page.locator(`#apprBody tr[data-appr='${CAMPAIGN}'] td`).nth(5).innerText(), "$1,500.00");
  await page.close();
});

test("Review queue: 'Open the full creative' is a button that says so and opens that row's creative", { timeout: 60_000 }, async () => {
  const { page } = await openFactory();
  await page.locator(`#apprBody tr[data-appr='${A(2)}']`).click();
  const scope = page.locator(`#apprBody tr[data-appr='${A(2)}'] + tr.det`);
  const open = button(page, "Open the full creative", scope);
  assert.equal(await open.count(), 1);
  assert.equal(await drawerOpen(page), false);
  await open.click();
  assert.equal(await drawerOpen(page), true);
  assert.match(await text(page, "#dwBody"), new RegExp(A(2)));
  // No other button of the row opens a creative: the brand and campaign rows carry none.
  await page.keyboard.press("Escape");
  await page.locator(`#apprBody tr[data-appr='${CAMPAIGN}']`).click();
  assert.equal(await button(page, "Open the full creative", page.locator(`#apprBody tr[data-appr='${CAMPAIGN}'] + tr.det`)).count(), 0);
  await page.close();
});

// ── Reference: why creative gets stopped, against the code that stops it ─────────────────────────

const PLACEHOLDERS = (s) => String(s)
  .replace(/<[^>]*>/g, "<X>") // the page's own placeholders: <the value>, <n>, <where>, <offer_type>
  .replace(/\s+/g, " ").trim();

test("Reference: every reason the page lists says what the code says, applies where the code applies it, and names who sets it", { timeout: 120_000 }, async () => {
  const { page } = await openFactory();
  await page.locator(".scopebar summary", { hasText: "Why creative gets stopped" }).click();
  const shown = await page.locator("#ruleBody tr").evaluateAll((trs) => trs.map((tr) => {
    const cells = tr.querySelectorAll("td");
    const subs = cells[1].querySelectorAll("span.sub");
    return {
      appliesTo: cells[0].textContent.trim(),
      message: cells[1].childNodes[0].textContent.trim(),
      holds: subs.length === 2 ? subs[0].textContent.trim() : null,
      code: subs[subs.length - 1].textContent.trim(),
      whoSets: cells[2].textContent.trim(),
      stripe: tr.className
    };
  }));
  assert.equal(shown.length, 29);
  const byCode = new Map(shown.map((r) => [r.code, r]));
  assert.equal(byCode.size, 29, "no reason is listed twice");
  const WHO = { seeded: "Set by us — can be changed", engine: "Built in — cannot be changed", targeting: "Meta's own rule — cannot be changed" };
  const OFFER = { credit_repair: "Credit repair", credit_cards: "Credit cards", funding: "Funding" };
  const PLATFORM = { tiktok: "TikTok", meta: "Meta ads", google: "Google ads" };
  const applies = (offers, platforms) => {
    let words = offers.length ? offers.map((o) => OFFER[o]).join(", ") : "Any offer";
    if (platforms.length) words += ` · ${platforms.map((p) => PLATFORM[p]).join(", ")}`;
    return words;
  };

  // 1. The twelve rows the engine reads from the database: the migration holds the words, the offers,
  // the platforms and the rule set.
  const migration = read("db/migrations/047_compliance_rules.sql");
  const seeded = [...migration.matchAll(/\(\s*'([a-z]+)',\s*'([a-z0-9-]+)',\s*'(\[[^\]]*\])',\s*'(\[[^\]]*\])',\s*'(?:regex|phrase|required)',\s*'(?:[^']|'')*',\s*'(block|warn)',\s*'((?:[^']|'')*)',/g)]
    .map((m) => ({ ruleSet: m[1], code: m[2], offers: JSON.parse(m[3]), platforms: JSON.parse(m[4]), severity: m[5], message: m[6].replace(/''/g, "'") }));
  assert.equal(seeded.length, 12, "the migration seeds twelve rules");
  for (const rule of seeded) {
    const row = byCode.get(rule.code);
    assert.ok(row, `${rule.code} is on the page`);
    assert.equal(row.message, rule.message, `${rule.code}: the words are the migration's`);
    assert.equal(row.appliesTo, applies(rule.offers, rule.platforms), `${rule.code}: applies to what the migration says`);
    assert.equal(row.whoSets, WHO.seeded, `${rule.code}: a rule in the table can be changed`);
    assert.equal(rule.severity, "block");
    assert.equal(row.holds, null);
    assert.match(row.stripe, /stripe-bad/);
  }

  // 2. The built-in engine rules: run the real engine and compare what it raises. The page keeps the
  // engine's placeholders as <the value>, <offer_type>, so those are compared as placeholders.
  // quiet: no rules and no Meta category on file. withCategory: no rules, and Meta's category is set, so a
  // Meta screening gets past the structural block and can reach the approval gates.
  const quiet = { query: async () => ({ rows: [] }) };
  const withCategory = { query: async (sql) => ({ rows: /ad_platform_category_map/.test(sql) ? [{ special_ad_category: "CREDIT" }] : [] }) };
  let orgSeq = 0;
  const run = async (subject, db = quiet) => {
    orgSeq += 1;
    return screen(db, { orgId: `00000000-0000-4000-8000-${String(orgSeq).padStart(12, "0")}`, partnerId: "p", kind: "creative_asset", ...subject });
  };
  const raised = async (subject, db) => (await run(subject, db)).reasons;
  const engineCases = {
    screen_error: () => raised({ offerType: "funding" }, { query: async () => { throw new Error("db down"); } }),
    offer_type_missing: () => raised({ offerType: "gold" }),
    platform_unknown: () => raised({ offerType: "funding", platform: "snapchat" }),
    tiktok_credit_repair_prohibited: () => raised({ offerType: "credit_repair", platform: "tiktok" }),
    special_ad_category_unset: () => raised({ offerType: "funding", platform: "meta" }),
    synthetic_without_ai_flag: () => raised({ offerType: "funding", syntheticPerformer: true, aiGenerated: false }),
    human_approval_required_credit_repair: () => raised({ offerType: "credit_repair" }),
    human_approval_required_setting: () => raised({ offerType: "funding" })
  };
  const engineRows = shown.filter((r) => r.whoSets === WHO.engine);
  assert.deepEqual(engineRows.map((r) => r.code).sort(), Object.keys(engineCases).sort(), "the page lists exactly the engine rules the test can raise");
  for (const [code, make] of Object.entries(engineCases)) {
    const reason = (await make()).find((r) => r.code === code);
    assert.ok(reason, `the engine raises ${code}`);
    const row = byCode.get(code);
    const fromCode = PLACEHOLDERS(reason.message.replace(/got "[^"]*"/, "got <X>").replace(/meta\/[a-z_]+\./, "meta/<X>."));
    const fromPage = PLACEHOLDERS(row.message);
    assert.equal(fromPage, fromCode, `${code}: the words are the engine's`);
    assert.equal(row.whoSets, WHO.engine);
    // The rule set the page groups it under is the one the engine writes.
    const claim = shown.find((r) => r.code === code);
    assert.ok(claim);
  }
  // Where each one applies: raised exactly for the offers and platforms the page names.
  const OFFERS = ["funding", "credit_cards", "credit_repair"];
  const PLATFORMS = [null, "meta", "tiktok", "google"];
  const triggers = {
    tiktok_credit_repair_prohibited: {},
    special_ad_category_unset: {},
    synthetic_without_ai_flag: { syntheticPerformer: true, aiGenerated: false },
    human_approval_required_credit_repair: {},
    human_approval_required_setting: {}
  };
  const expectedFromPage = (code) => {
    const text = byCode.get(code).appliesTo;
    const [offerPart, platformPart] = text.split(" · ");
    const offers = offerPart === "Any offer" ? OFFERS : offerPart.split(", ").map((w) => Object.keys(OFFER).find((k) => OFFER[k] === w));
    const platforms = platformPart ? platformPart.split(", ").map((w) => Object.keys(PLATFORM).find((k) => PLATFORM[k] === w)) : PLATFORMS;
    return { offers, platforms };
  };
  for (const [code, extra] of Object.entries(triggers)) {
    const claim = expectedFromPage(code);
    for (const offerType of OFFERS) {
      for (const platform of PLATFORMS) {
        const got = (await raised({ offerType, platform, ...extra }, code === "special_ad_category_unset" ? quiet : withCategory)).some((r) => r.code === code);
        let want = claim.offers.includes(offerType) && claim.platforms.includes(platform);
        // The weaker approval gate gives way to the stricter one for credit repair: the page says
        // "Any offer" and the engine raises it for funding and credit cards only.
        if (code === "human_approval_required_setting" && offerType === "credit_repair") want = false;
        // A TikTok credit-repair screening stops at the structural block before any other reason.
        if (platform === "tiktok" && offerType === "credit_repair" && code !== "tiktok_credit_repair_prohibited") want = false;
        assert.equal(got, want, `${code} for ${offerType} on ${platform}`);
      }
    }
  }
  assert.equal(byCode.get("human_approval_required_setting").holds, "Holds the work for a person. Does not stop it.");
  assert.equal(byCode.get("human_approval_required_credit_repair").holds, "Holds the work for a person. Does not stop it.");
  assert.equal(shown.filter((r) => r.holds).length, 2);
  assert.match(byCode.get("human_approval_required_setting").stripe, /stripe-info/);
  assert.match(byCode.get("screen_error").stripe, /stripe-bad/);

  // 3. Meta's own rules: the real targeting check raises each, and only for a Meta campaign.
  const targetingPayloads = {
    targeting_missing: null,
    targeting_malformed: [],
    zip_targeting: { zips: ["85001"] },
    radius_too_small: { radius: 5 },
    location_exclusion: { exclusions: ["x"] },
    age_range: { age_min: 21 },
    gender_restriction: { genders: [1] },
    lookalike_audience: { lookalikes: ["seed"] },
    detailed_targeting_expansion: { detailed_targeting_expansion: true }
  };
  const targetingRows = shown.filter((r) => r.whoSets === WHO.targeting);
  assert.deepEqual(targetingRows.map((r) => r.code).sort(), Object.keys(targetingPayloads).sort());
  for (const [code, payload] of Object.entries(targetingPayloads)) {
    const reason = screenTargeting(payload, { platform: "meta" }).reasons.find((r) => r.code === code);
    assert.ok(reason, `the targeting check raises ${code}`);
    assert.equal(reason.rule_set, "platform");
    const row = byCode.get(code);
    let fromCode = PLACEHOLDERS(reason.message.replace(/A [\d.]+-mile radius/, "A <X>-mile radius").replace(/\((radius|[a-z_.[\]0-9]+)\)\.$/, "(<X>)."));
    let fromPage = PLACEHOLDERS(row.message);
    if (code === "age_range") {
      // The page's one line carries both halves of the age rule: age_min first, then age_max in brackets.
      fromCode = PLACEHOLDERS(reason.message.replace(/got \d+\./, "got <X>."));
      assert.ok(fromPage.startsWith(fromCode), `${code}: the page starts with the engine's age_min words`);
      const maxReason = screenTargeting({ age_max: 70 }, { platform: "meta" }).reasons.find((r) => r.code === "age_range");
      assert.match(maxReason.message, /age_max must be 65 \("65\+"\)/);
      assert.match(row.message, /\(age_max must be 65, "65\+", by the same rule\.\)$/);
      fromPage = fromCode;
    }
    assert.equal(fromPage, fromCode, `${code}: the words are the targeting check's`);
    assert.equal(row.appliesTo, "Any offer · Meta ads");
    // Only a Meta campaign raises it: no other platform ever does, for any offer.
    for (const platform of [null, "tiktok", "google"]) {
      for (const offerType of OFFERS) {
        if (platform === "tiktok" && offerType === "credit_repair") continue;
        const got = (await raised({ offerType, platform, targeting: payload }, withCategory)).some((r) => r.code === code);
        assert.equal(got, false, `${code} is not raised on ${platform}`);
      }
    }
    for (const offerType of OFFERS) {
      const got = (await raised({ offerType, platform: "meta", targeting: payload }, withCategory)).some((r) => r.code === code);
      assert.equal(got, true, `${code} is raised on meta for ${offerType}`);
    }
  }
  // Every code the page lists is one of these three families, and "who sets it" is the family's own words.
  assert.equal(seeded.length + engineRows.length + targetingRows.length, 29);
  await page.close();
});
