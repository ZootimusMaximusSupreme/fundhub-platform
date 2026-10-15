// Batch 11 practice tests: the Creative Factory screen (public/app/creative-factory.html).
//
// Real page in Chromium, fake /api answers, every control pressed, and the exact request and the
// words painted judged. Nothing reaches a real database, a vendor or the network. This is a practice
// test, not a live check: the live checks for what Save script, Enqueue, Run, Approve, Reject,
// Archive, the brand buttons and the allowance leave behind are in fin-b11-live-contracts.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bodyOf, clearShellOverlays, dialogs, json, OWNER, proofRows, sharedScreens, waitFor
} from "./fin-b11-kit.mjs";
import { PROVIDER_KEYS } from "../../../creative/providers/index.mjs";

const proof = proofRows(import.meta.url);
const { open } = sharedScreens();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

/** A held answer: the stand-in server waits on wait() until release() is called. */
function gate() {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  return { wait, release };
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The page's own time words ("Oct 14 11:30") for an ISO stamp. */
const stamp = (ts) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(ts);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])} ${m[4]}:${m[5]}`;
};

const P1 = "aa000000-0000-4000-8000-000000000001";
const P2 = "aa000000-0000-4000-8000-000000000002";
const K1 = "bb000000-0000-4000-8000-000000000001";
const K2 = "bb000000-0000-4000-8000-000000000002";
const A = (n) => `cc000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const J = (n) => `dd000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S1 = "ee000000-0000-4000-8000-000000000001";
const S2 = "ee000000-0000-4000-8000-000000000002";
const BRAND = "ff000000-0000-4000-8000-000000000001";
const CAMPAIGN = "ff000000-0000-4000-8000-000000000002";
const iso = (minutesAgo) => new Date(Date.UTC(2026, 9, 14, 12, 0, 0) - minutesAgo * 60_000).toISOString();

const PARTNERS = [
  { id: P1, name: "Alpha Funding", slug: "alpha" },
  { id: P2, name: "Beta Capital", slug: "beta" }
];

const REASON = { code: "guaranteed-approval", rule_set: "claims", message: "Guaranteed approval cannot be advertised. Approval depends on underwriting." };
const asset = (n, over) => ({
  id: A(n), brand_kit_id: K1, kind: "static", format: "1x1", provider: "static", duration_sec: null, copy_text: null,
  ai_generated: true, synthetic_performer: false, compliance_state: "passed", blocked_reasons: [], parent_asset_id: null,
  archived_at: null, created_at: iso(n * 60), updated_at: iso(n * 60), ...over
});
const LIBRARY = () => [
  asset(1, { compliance_state: "pending" }),
  asset(2, { kind: "copy", format: "4x5", provider: "copy", compliance_state: "blocked", blocked_reasons: [REASON], copy_text: "Working capital for owners, guaranteed approval." }),
  asset(3, { kind: "video", format: "9x16", provider: "ugc-video", brand_kit_id: K2, compliance_state: "approved", duration_sec: 22, synthetic_performer: true }),
  asset(4, { format: "16x9" }),
  asset(5, { compliance_state: "approved", archived_at: iso(30) }),
  asset(6, { kind: "copy", format: "1x1", provider: "copy", brand_kit_id: K2, copy_text: "Funding that moves at the speed of your business." }),
  asset(7, { kind: "video", format: "16x9", provider: "product-video", compliance_state: "pending" }),
  asset(8, { format: "4x5", brand_kit_id: K2, compliance_state: "blocked", blocked_reasons: [REASON] }),
  asset(9, { format: "9x16" })
];
const job = (n, over) => ({
  id: J(n), brand_kit_id: null, provider: "static", status: "succeeded", attempt: 1, error: null, idempotency_key: `batch-${n}`,
  started_at: iso(n * 10), finished_at: iso(n * 10 - 1), created_at: iso(n * 10 + 1), asset_kind: "static", formats: ["1x1"], variants: 1, asset_count: 2, ...over
});
const JOBS = () => [
  job(1, { status: "queued", attempt: 0, started_at: null, finished_at: null, provider: null }),
  job(2, { status: "queued", attempt: 0, started_at: null, finished_at: null, provider: null, asset_kind: "copy", asset_count: 0 }),
  job(3, { status: "queued", attempt: 1, started_at: null, finished_at: null, error: "provider returned zero assets", asset_count: 0 }),
  job(4, { status: "running", attempt: 1, finished_at: null, asset_count: 0 }),
  job(5), job(6), job(7, { asset_kind: "video", formats: ["9x16"], asset_count: 1, brand_kit_id: K1 }), job(8), job(9),
  job(10, { status: "failed", attempt: 3, error: "no active provider configured", provider: null, asset_count: 0, brand_kit_id: K2 }),
  job(11, { status: "failed", attempt: 3, error: "provider returned zero assets", asset_count: 0 }),
  job(12, { status: "failed", attempt: 3, error: "socket hang up while calling the vendor", asset_count: 0 })
];
const kit = (n, status) => ({
  id: n === 1 ? K1 : n === 2 ? K2 : `bb000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name: `Kit ${n}`, source_url: null, scraped_at: null,
  palette: { ink: "#0A0A0A", paper: "#FCFCFC" }, fonts: { display: "Inter" }, voice_profile: { tone: "plain and direct" }, products: [{ name: "Working capital" }],
  status, logo_asset_id: null, asset_count: n, created_at: iso(n * 100), updated_at: iso(n * 100)
});
const KITS = () => [kit(1, "active"), kit(2, "active"), kit(3, "draft"), kit(4, "draft"), kit(5, "archived"), kit(6, "archived"), kit(7, "active")];
const APPROVALS = () => [
  { item_type: "creative_asset", id: A(2), state: "blocked", subtype: "copy", detail: "4x5", reasons: [REASON], budget_cents: null, offer_type: null, platform: null, ai_generated: true, synthetic_performer: false, updated_at: iso(60) },
  { item_type: "creative_asset", id: A(1), state: "pending", subtype: "static", detail: "1x1", reasons: [], budget_cents: null, offer_type: null, platform: null, ai_generated: true, synthetic_performer: false, updated_at: iso(120) },
  { item_type: "campaign", id: CAMPAIGN, state: "awaiting_approval", subtype: "retargeting", detail: "Spring push", reasons: [{ code: "needs_approval", message: [{ code: "human_approval_required_setting", rule_set: "approval", message: "This partner has approve_before_launch enabled." }] }], budget_cents: 150000, offer_type: "funding", platform: "meta", ai_generated: null, synthetic_performer: null, updated_at: iso(180) },
  { item_type: "partner_brand", id: BRAND, state: "review", subtype: "brand", detail: "Alpha Funding LLC", reasons: [], budget_cents: null, offer_type: null, platform: null, ai_generated: null, synthetic_performer: null, updated_at: iso(240) }
];
/** Twelve creative rows after the four above, so the queue has a second and a third page at size five. */
const APPROVALS_BIG = () => [
  ...APPROVALS(),
  ...Array.from({ length: 8 }, (_, i) => ({
    item_type: "creative_asset", id: A(20 + i), state: i % 2 ? "blocked" : "pending", subtype: "static", detail: "1x1", reasons: i % 2 ? [REASON] : [],
    budget_cents: null, offer_type: null, platform: null, ai_generated: true, synthetic_performer: false, updated_at: iso(300 + i * 10)
  }))
];
const SCRIPTS = () => [
  { id: S1, title: "Denial angle", version: 2, body_preview: "Banks said no. Here is why." },
  { id: S2, title: null, version: 1, body_preview: "Your credit file is not your fault. It is a record." }
];
const page200 = (items) => ({ ok: true, count: items.length, limit: 200, offset: 0, hasMore: false, items });

/**
 * Open the screen with a stand-in server. `st` holds what each read answers (a test swaps them), and
 * `log` holds every request in order. `answers` decides what a write returns.
 */
const BOTH_ON = () => ({
  [P1]: { ok: true, enabled: true, cap: 250000, used: 1200, remaining: 248800 },
  [P2]: { ok: true, enabled: true, cap: 80000, used: 300, remaining: 79700 }
});

async function openFactory({ session = OWNER, query = "", viewport, st: over = {}, answers = {} } = {}) {
  const st = {
    partners: PARTNERS,
    usage: { [P1]: { ok: true, enabled: true, cap: 250000, used: 1200, remaining: 248800 }, [P2]: { ok: true, enabled: false, cap: 250000, used: 0, remaining: 250000 } },
    jobs: JOBS(), library: LIBRARY(), kits: KITS(), approvals: APPROVALS(), scripts: SCRIPTS(), usageStatus: {}, usageGate: null, ...over
  };
  const log = { reads: [], generate: [], run: [], actions: [], scriptWrite: [], brand: [], usage: [] };
  const pidOf = (url) => new URL(url).searchParams.get("partner_id");
  const handlers = {
    "/api/read/partners": async (route) => json(route, page200(st.partners)),
    "/api/partner-marketing/usage": async (route, { url }) => {
      const pid = pidOf(url);
      log.usage.push(pid);
      if (st.usageGate) await st.usageGate.wait;
      const status = st.usageStatus[pid];
      if (status) return json(route, status.body, status.status);
      return json(route, st.usage[pid] || { ok: false, message: "No such partner." });
    },
    "/api/creative/jobs": async (route, { url }) => { log.reads.push(["jobs", pidOf(url)]); return json(route, page200(st.jobs)); },
    "/api/creative/library": async (route, { url }) => { log.reads.push(["library", pidOf(url)]); return json(route, page200(st.library)); },
    "/api/creative/brand-kits": async (route, { url }) => { log.reads.push(["kits", pidOf(url)]); return json(route, page200(st.kits)); },
    "/api/creative/approvals": async (route, { url }) => { log.reads.push(["approvals", pidOf(url)]); return json(route, page200(st.approvals)); },
    "/api/scripts/list": async (route, { url }) => { log.reads.push(["scripts", pidOf(url)]); return json(route, page200(st.scripts)); },
    "/api/read/video-stats": async (route) => json(route, { ok: true, connection: null, videos: [] }),
    "/api/creative/generate": async (route) => {
      log.generate.push(bodyOf(route));
      const out = answers.generate ? answers.generate(log.generate.length) : { status: 200, body: { ok: true, created: true, note: "Saved to the queue." } };
      return json(route, out.body, out.status);
    },
    "/api/creative/run": async (route) => {
      log.run.push(bodyOf(route));
      const out = answers.run ? answers.run(log.run.length) : { status: 200, body: { ok: true, ran: 2, succeeded: 1, failed: 1, requeued: 0, note: "Some did not work. The reason is on the job in the list below." } };
      return json(route, out.body, out.status);
    },
    "/api/creative/actions": async (route) => {
      const body = bodyOf(route);
      log.actions.push(body);
      // Like the real endpoint: the named creative changes, and the next library read shows it.
      const found = st.library.find((a) => a.id === body.asset_id);
      if (found && !answers.actions) {
        if (body.action === "approve") { found.compliance_state = "approved"; found.blocked_reasons = []; }
        if (body.action === "reject") { found.compliance_state = "blocked"; found.blocked_reasons = [{ code: "human_reject", rule_set: "approval", message: "Rejected by reviewer" }]; }
        if (body.action === "archive") found.archived_at = iso(0);
      }
      const out = answers.actions ? answers.actions(body) : { status: 200, body: { ok: true, action: body.action, asset: { ...(found || { id: body.asset_id }) } } };
      return json(route, out.body, out.status);
    },
    "/api/scripts/write": async (route) => {
      const body = bodyOf(route);
      log.scriptWrite.push(body);
      const out = answers.scriptWrite
        ? answers.scriptWrite(body)
        : { status: 200, body: { ok: true, created: true, script: { id: "ee000000-0000-4000-8000-0000000000aa", title: body.title || null, body: body.body, version: 1 },
            labels: { script_type: body.script_type || null, lane: body.lane || null, angle_key: (body.angle_key || "").toLowerCase().replace(/\s+/g, "_") || null, hook_key: body.hook_key || null, offer_key: body.offer_key || null },
            dictionary: body.angle_key ? [{ kind: "angle", key: body.angle_key.toLowerCase().replace(/\s+/g, "_") }] : [] } };
      return json(route, out.body, out.status);
    },
    "/api/brand/review": async (route) => {
      const body = bodyOf(route);
      log.brand.push(body);
      const out = answers.brand ? answers.brand(body) : { status: 200, body: { ok: true, action: body.action, partner_id: body.partner_id, approval_status: body.action === "approve" ? "approved" : "draft" } };
      return json(route, out.body, out.status);
    }
  };
  const opened = await open(`/app/creative-factory.html${query}`, { session, handlers, ...(viewport ? { viewport } : {}) });
  await waitFor(() => ["jobs", "library", "kits", "approvals", "scripts"].every((k) => log.reads.some(([name]) => name === k)), "the five creative reads");
  await waitFor(async () => (await opened.page.locator("#jobBody tr[data-job]").count()) > 0, "jobs painted");
  await clearShellOverlays(opened.page);
  return { ...opened, st, log };
}

const text = (page, selector) => page.locator(selector).innerText();
const count = (page, selector) => page.locator(selector).count();
const readsFor = (log, name) => log.reads.filter(([n]) => n === name).map(([, pid]) => pid);
const chipTexts = (page, selector) => page.locator(`${selector} button`).evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
const drawerOpen = (page) => page.evaluate(() => document.getElementById("drawer").classList.contains("on"));

test("the page loads, the partner picker re-reads everything, and ?partner_id= preselects", { timeout: 90_000 }, async () => {
  await proof.check(/^Page itself loads/, async () => {
    const { page, errors, log } = await openFactory();
    assert.deepEqual(errors, [], "no script error on load");
    assert.deepEqual(readsFor(log, "jobs"), [P1]);
    assert.equal((await text(page, "#stats")).includes("JOBS IN FLIGHT"), true);
    assert.match(await text(page, "#stats"), /FAILED JOBS[\s\S]*3/);
    assert.match(await text(page, "#footNote"), /alpha funding/);
    assert.equal(await page.locator("#secScriptWrite").evaluate((el) => el.style.display), "", "an owner sees the script card");
    await page.close();

    // The script card is staff work: a partner login does not draw it.
    const partner = await open("/app/creative-factory.html", {
      session: { ok: true, staff: { id: "p1", name: "Pat", role: "partner", org_id: "org-1", status: "active", partner_id: P1 } },
      handlers: {
        "/api/read/partners": page200([PARTNERS[0]]),
        "/api/partner-marketing/usage": { ok: true, enabled: true, cap: 250000, used: 0, remaining: 250000 },
        "/api/read/video-stats": { ok: true, connection: null, videos: [] }
      }
    });
    await partner.page.waitForTimeout(500);
    assert.match(partner.page.url(), /creative-factory\.html/);
    assert.equal(await partner.page.locator("#secScriptWrite").evaluate((el) => el.style.display), "none", "a partner does not see the script card");
    await partner.page.close();

    // Only owner and admin reach this screen. A closer is sent to their own desk, and nothing of the
    // creative reads is asked for.
    const closerReads = [];
    const closer = await open("/app/creative-factory.html", {
      session: { ok: true, staff: { id: "s3", name: "Riley", role: "closer", org_id: "org-1", status: "active" } },
      handlers: { "/api/creative": (route, { url }) => { closerReads.push(url); return json(route, page200([])); } }
    });
    await waitFor(() => closer.page.url().includes("closer-dashboard.html"), "the closer moved to the closer dashboard");
    assert.deepEqual(closerReads, []);
    await closer.page.close();
  });

  await proof.check(/^Partner picker \(select\) and \?partner_id= preselect/, async () => {
    const { page, log } = await openFactory();
    const options = await page.locator("#partnerSel option").allInnerTexts();
    assert.deepEqual(options, ["Alpha Funding", "Beta Capital"]);
    assert.equal(await page.locator("#partnerSel").inputValue(), "0");
    assert.match(await text(page, "#scopePid"), /Alpha Funding/);
    const before = log.reads.length;
    await page.locator("#partnerSel").selectOption("1");
    await waitFor(() => ["jobs", "library", "kits", "approvals", "scripts"].every((k) => readsFor(log, k).includes(P2)), "all five reads for the second partner");
    assert.ok(log.reads.length >= before + 5);
    await waitFor(() => log.usage.includes(P2), "the allowance read for the second partner");
    assert.match(await text(page, "#scopePid"), /Beta Capital/);
    assert.match(await text(page, "#scopeHow"), /Beta Capital/);
    assert.equal(new URL(page.url()).searchParams.get("partner_id"), P2, "the address follows the picker");
    await page.close();

    // An address that names a partner opens on that partner, and the first reads are for it.
    const named = await openFactory({ query: `?partner_id=${P2}` });
    assert.equal(await named.page.locator("#partnerSel").inputValue(), "1");
    assert.deepEqual(readsFor(named.log, "jobs"), [P2]);
    assert.deepEqual(named.log.usage, [P2]);
    await named.page.close();

    // No partners on file: nothing is requested and the picker says so.
    const none = await open("/app/creative-factory.html", { session: OWNER, handlers: { "/api/read/partners": page200([]), "/api/read/video-stats": { ok: true, connection: null, videos: [] } } });
    await waitFor(async () => /No partners on file/.test(await text(none.page, "#partnerSel")), "the empty picker");
    assert.equal(await none.page.locator("#partnerSel").isDisabled(), true);
    await none.page.close();
  });
});

test("the allowance panel, the Brand Studio link and Enqueue", { timeout: 120_000 }, async () => {
  const on = await openFactory();
  const writeControls = (page) => page.locator("#genBtn, #runJobsBtn, [data-cact]");
  await proof.check(/^Monthly writing allowance panel/, async () => {
    await waitFor(async () => (await on.page.locator("#cfUseBody .stat").count()) === 4, "the allowance painted");
    assert.equal(await on.page.locator("#cfUseBadge").evaluate((el) => el.textContent), "on");
    const tilesOf = (page) => page.locator("#cfUseBody .stat").evaluateAll((els) => els.map((e) => `${e.querySelector(".eyebrow").textContent} ${e.querySelector(".sv").textContent}`));
    assert.deepEqual(await tilesOf(on.page), ["On? Yes", "Used this month 1200", "Left 248800", "Monthly limit 250000"]);
    assert.doesNotMatch(await text(on.page, "#cfUseBody"), /has not turned this on/);
    assert.equal(await on.page.locator("#cfWriteChipTxt").evaluate((el) => el.textContent), "Writes on");

    // Off: the same four tiles, and the enable note.
    const off = await openFactory({ query: `?partner_id=${P2}` });
    await waitFor(async () => /has not turned this on for this partner/i.test(await text(off.page, "#cfUseBody")), "the enable note");
    assert.equal(await off.page.locator("#cfUseBadge").evaluate((el) => el.textContent), "off");
    assert.deepEqual(await tilesOf(off.page), ["On? No", "Used this month 0", "Left 250000", "Monthly limit 250000"]);
    assert.equal(await off.page.locator("#cfWriteChipTxt").evaluate((el) => el.textContent), "Read only");
    await off.page.close();

    // A refusal and a failed read say it in words and switch the writes off.
    const refused = await openFactory({ st: { usageStatus: { [P1]: { status: 403, body: { ok: false, error: "forbidden" } } } } });
    await waitFor(async () => /only the owner or this partner can see this allowance\./i.test(await text(refused.page, "#cfUseBody")), "the 403 words");
    assert.equal(await refused.page.locator("#cfUseBadge").evaluate((el) => el.textContent), "owner / partner");
    assert.equal(await refused.page.locator("#genBtn").isDisabled(), true);
    await refused.page.close();
    const broken = await openFactory({ st: { usageStatus: { [P1]: { status: 200, body: { ok: false, message: "The meter is down." } } } } });
    await waitFor(async () => /the meter is down\./i.test(await text(broken.page, "#cfUseBody")), "the error words");
    assert.equal(await broken.page.locator("#cfUseBadge").evaluate((el) => el.textContent), "error");
    await broken.page.close();
  });

  await proof.check(/^Link: 'Brand Studio'/, async () => {
    const off = await openFactory({ query: `?partner_id=${P2}` });
    await waitFor(async () => (await off.page.locator("#cfUseBody a[href='brand-studio.html']").count()) === 1, "the link in the note");
    assert.equal(await text(off.page, "#cfUseBody a"), "Brand Studio");
    // Followed, it opens the Brand Studio screen itself: the server answers 200 with that page, not a
    // "not found" body that merely sits at the right address.
    const [answer] = await Promise.all([
      off.page.waitForResponse((r) => r.request().isNavigationRequest() && /\/app\/brand-studio\.html$/.test(new URL(r.url()).pathname)),
      off.page.locator("#cfUseBody a[href='brand-studio.html']").click()
    ]);
    assert.equal(answer.status(), 200, "the Brand Studio screen exists");
    await off.page.waitForLoadState("domcontentloaded");
    assert.match(off.page.url(), /\/app\/brand-studio\.html$/);
    assert.equal(await off.page.title(), "Fundhub — Brand Studio");
    assert.equal(await off.page.locator("h1").first().innerText(), "Brand Studio");
    await off.page.close();
    // When the suite is on there is no note and no link.
    assert.equal(await count(on.page, "#cfUseBody a[href='brand-studio.html']"), 0);
  });

  await proof.check(/^Enqueue generation button/, async () => {
    // Off: every write control stays disabled and says why. Approve, Reject and Archive all follow the
    // allowance, not just the first of them.
    const off = await openFactory({ query: `?partner_id=${P2}` });
    await waitFor(async () => /has not turned this on for this partner/.test(await text(off.page, "#genMsg")), "the reason line");
    assert.equal(await off.page.locator("#genBtn").isDisabled(), true);
    assert.equal(await off.page.locator("#runJobsBtn").isDisabled(), true);
    assert.deepEqual(await off.page.locator("[data-cact]").evaluateAll((els) => els.map((e) => [e.dataset.cact, e.disabled])),
      [["approve", true], ["reject", true], ["archive", true]]);
    assert.match(await text(off.page, "#actMsg"), /has not turned this on for this partner/);
    // And they fail closed before any script has run: every write control is disabled in the page's own
    // markup, so a script that never starts leaves nothing pressable.
    const markup = await off.page.evaluate(() => fetch(location.pathname).then((r) => r.text()));
    for (const needle of ['id="genBtn"', 'id="runJobsBtn"', 'data-cact="approve"', 'data-cact="reject"', 'data-cact="archive"']) {
      const tag = new RegExp(`<button[^>]*${needle}[^>]*>`).exec(markup);
      assert.ok(tag, `${needle} is in the page`);
      assert.match(tag[0], /\sdisabled(\s|>)/, `${needle} starts disabled`);
    }
    await off.page.close();

    // Loading: until the allowance answers, nothing can be pressed, and the screen says it is waiting.
    const held = gate();
    const loading = await openFactory({ st: { usageGate: held } });
    await waitFor(() => loading.log.usage.length === 1, "the allowance read started");
    assert.equal(await loading.page.locator("#genBtn").isDisabled(), true, "Enqueue stays off while the allowance loads");
    assert.equal(await loading.page.locator("#runJobsBtn").isDisabled(), true, "Run stays off while the allowance loads");
    assert.deepEqual(await loading.page.locator("[data-cact]").evaluateAll((els) => els.map((e) => e.disabled)), [true, true, true]);
    assert.match(await text(loading.page, "#genMsg"), /These buttons stay off until the allowance has loaded\./);
    assert.match(await text(loading.page, "#cfUseBody"), /Loading the allowance/i);
    assert.deepEqual(loading.log.generate, []);
    held.release();
    await waitFor(async () => await loading.page.locator("#genBtn").isEnabled(), "Enqueue enabled once it loaded");
    assert.deepEqual(await loading.page.locator("[data-cact]").evaluateAll((els) => els.map((e) => e.disabled)), [false, false, false]);
    assert.doesNotMatch(await text(loading.page, "#genMsg"), /allowance has loaded/, "the waiting words go away");
    await loading.page.close();

    // On: enabled. A missing name or offer stops before anything is sent.
    await waitFor(async () => await on.page.locator("#genBtn").isEnabled(), "Enqueue enabled");
    await on.page.locator("#genBtn").click();
    assert.equal(await text(on.page, "#genMsg"), "Give this batch a name first.");
    await on.page.locator("#genIdem").fill("  oct-batch  ");
    await on.page.locator("#genBtn").click();
    assert.equal(await text(on.page, "#genMsg"), "Say what is being sold first.");
    assert.deepEqual(on.log.generate, []);

    // Filled in: exactly what the four boxes hold is sent, trimmed, with the formats and variants.
    await on.page.locator("#genOffer").selectOption("credit_cards");
    await on.page.locator("#genPrompt").fill("  Working capital for owners…  ");
    await on.page.locator("#genBtn").click();
    await waitFor(() => on.log.generate.length === 1, "the enqueue request");
    assert.deepEqual(on.log.generate[0], {
      partner_id: P1, asset_kind: "static", idempotency_key: "oct-batch", prompt: "Working capital for owners…",
      spec: { prompt: "Working capital for owners…", formats: ["1x1"], variants: 1, assetKind: "static", offerType: "credit_cards" }
    });
    await waitFor(async () => /Saved to the queue\./.test(await text(on.page, "#genMsg")), "the server's note");
    // The panels were read again after the save.
    await waitFor(() => readsFor(on.log, "jobs").length >= 2, "the jobs read again");

    // A write for the partner on screen goes to that partner: with the second partner picked, the
    // request names the second partner, not the first.
    const second = await openFactory({ query: `?partner_id=${P2}`, st: { usage: BOTH_ON() } });
    await waitFor(async () => await second.page.locator("#genBtn").isEnabled(), "Enqueue enabled for the second partner");
    await second.page.locator("#genIdem").fill("beta-batch");
    await second.page.locator("#genOffer").selectOption("funding");
    await second.page.locator("#genPrompt").fill("Lines of credit");
    await second.page.locator("#genBtn").click();
    await waitFor(() => second.log.generate.length === 1, "the second partner's request");
    assert.equal(second.log.generate[0].partner_id, P2);
    assert.equal(second.log.generate[0].idempotency_key, "beta-batch");
    await second.page.close();

    // The server says no, says the batch name was used, then says yes with no note: each in its own words.
    const answers = {
      generate: (n) => n === 1 ? { status: 403, body: { ok: false, error: "suite_off" } }
        : n === 2 ? { status: 200, body: { ok: true, created: false } }
        : { status: 200, body: { ok: true, created: true } }
    };
    const talk = await openFactory({ answers });
    await waitFor(async () => await talk.page.locator("#genBtn").isEnabled(), "Enqueue enabled");
    await talk.page.locator("#genIdem").fill("again");
    await talk.page.locator("#genOffer").selectOption("funding");
    await talk.page.locator("#genPrompt").fill("Anything");
    await talk.page.locator("#genBtn").click();
    await waitFor(async () => /^Could not add it\. This part of the system is switched off for this partner\. Only the owner can turn it on\./.test(await text(talk.page, "#genMsg")), "the refusal words");
    assert.doesNotMatch(await text(talk.page, "#genMsg"), /suite_off|Saved to the queue/);
    await talk.page.locator("#genBtn").click();
    await waitFor(async () => (await text(talk.page, "#genMsg")) === "That batch name was already used, so nothing new was added.", "the already-used words");
    await talk.page.locator("#genBtn").click();
    await waitFor(async () => (await text(talk.page, "#genMsg")) === "Saved to the queue.", "the plain saved words");
    assert.equal(talk.log.generate.length, 3);
    await talk.page.close();
  });

  await proof.check(/^Generate form: Kind/, async () => {
    const kinds = await on.page.locator("#genKind option").allInnerTexts();
    assert.deepEqual(kinds, ["static", "copy", "video"]);
    const offers = await on.page.locator("#genOffer option").evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(offers, ["", "funding", "credit_cards", "credit_repair"]);
    const before = on.log.generate.length;
    for (const [kind, offer] of [["copy", "funding"], ["video", "credit_repair"]]) {
      await on.page.locator("#genKind").selectOption(kind);
      await on.page.locator("#genOffer").selectOption(offer);
      await on.page.locator("#genPrompt").fill(`${kind} for ${offer}`);
      await on.page.locator("#genIdem").fill(`${kind}-batch`);
      await on.page.locator("#genBtn").click();
      await waitFor(() => on.log.generate.length === before + (kind === "copy" ? 1 : 2), `the ${kind} request`);
    }
    const [copy, video] = on.log.generate.slice(before);
    assert.equal(copy.asset_kind, "copy");
    assert.equal(copy.spec.assetKind, "copy");
    assert.equal(copy.spec.offerType, "funding");
    assert.equal(copy.idempotency_key, "copy-batch");
    assert.equal(copy.prompt, "copy for funding");
    assert.equal(copy.spec.prompt, "copy for funding");
    assert.equal(video.asset_kind, "video");
    assert.equal(video.spec.offerType, "credit_repair");
    assert.equal(video.spec.prompt, "video for credit_repair");
    assert.equal(video.idempotency_key, "video-batch");
    // A picked script rides in the spec; "none" sends no script id at all.
    assert.equal("scriptId" in copy.spec, false);
    await on.page.locator("#genScript").selectOption(S1);
    await on.page.locator("#genIdem").fill("with-script");
    await on.page.locator("#genBtn").click();
    await waitFor(() => on.log.generate.length === before + 3, "the scripted request");
    assert.equal(on.log.generate[before + 2].spec.scriptId, S1);
  });

  await proof.check(/^Run queued jobs now button/, async () => {
    await on.page.locator("#runJobsBtn").click();
    await waitFor(() => on.log.run.length === 1, "the run request");
    assert.deepEqual(on.log.run[0], { partner_id: P1, max_jobs: 3 });
    await waitFor(async () => /Tried 2 jobs: 1 worked, 1 did not\. Some did not work\./.test(await text(on.page, "#genMsg")), "how it went, in words");
    await on.page.close();

    const nothing = await openFactory({ answers: { run: () => ({ status: 200, body: { ok: true, ran: 0, note: "Nothing was waiting to run. Add a batch first, then press this again." } }) } });
    await waitFor(async () => await nothing.page.locator("#runJobsBtn").isEnabled(), "Run enabled");
    await nothing.page.locator("#runJobsBtn").click();
    await waitFor(async () => /^Nothing ran\. Nothing was waiting to run\./.test(await text(nothing.page, "#genMsg")), "the nothing-ran words");
    await nothing.page.close();

    const refused = await openFactory({ answers: { run: () => ({ status: 403, body: { ok: false, error: "suite_off" } }) } });
    await waitFor(async () => await refused.page.locator("#runJobsBtn").isEnabled(), "Run enabled");
    await refused.page.locator("#runJobsBtn").click();
    await waitFor(async () => /Could not run it\. This part of the system is switched off for this partner\./.test(await text(refused.page, "#genMsg")), "the refusal words");
    assert.doesNotMatch(await text(refused.page, "#genMsg"), /suite_off/);
    await refused.page.close();

    // A run for the second partner names the second partner.
    const second = await openFactory({ query: `?partner_id=${P2}`, st: { usage: BOTH_ON() } });
    await waitFor(async () => await second.page.locator("#runJobsBtn").isEnabled(), "Run enabled for the second partner");
    await second.page.locator("#runJobsBtn").click();
    await waitFor(() => second.log.run.length === 1, "the second partner's run");
    assert.deepEqual(second.log.run[0], { partner_id: P2, max_jobs: 3 });
    await second.page.close();
  });
});

test("Decide on one creative: the picker, then Approve, Reject and Archive each ask first", { timeout: 120_000 }, async () => {
  const { page, log } = await openFactory();
  const ask = dialogs(page);
  await waitFor(async () => (await page.locator("#actAsset option").count()) === 10, "ten picker options");
  const chips = () => chipTexts(page, "#libStateRail");
  const libraryReads = () => readsFor(log, "library").length;

  await proof.check(/^Decide on one creative: creative picker/, async () => {
    const options = await page.locator("#actAsset option").allInnerTexts();
    assert.equal(options[0], "Choose a creative…");
    assert.equal(options.length, 10, "every creative, archived ones too");
    assert.ok(options.some((o) => /archived/.test(o)), "an archived creative says so");
    assert.match(options[1], /^static · 1x1 · pending · cc000000/);
    assert.ok(options.some((o) => /^copy · 4x5 · blocked/.test(o)));
    // Each option carries its own creative's id, in library order, so a pick names exactly that creative.
    assert.deepEqual(await page.locator("#actAsset option").evaluateAll((els) => els.map((e) => e.value)), ["", ...Array.from({ length: 9 }, (_, i) => A(i + 1))]);
    // The picker holds the library as read; with the library unreadable it offers none.
    const empty = await openFactory({ st: { library: [] } });
    assert.equal(await text(empty.page, "#actAsset"), "No creatives loaded for this partner");
    await empty.page.close();
  });

  await proof.check(/^Approve button \(asks to confirm/, async () => {
    // Nothing chosen: said, nothing sent.
    await page.locator("[data-cact='approve']").click();
    assert.equal(await text(page, "#actMsg"), "Choose a creative first.");
    // A creative in the middle of the list, so "always the first" and "always the last" both fail.
    await page.locator("#actAsset").selectOption(A(4));
    // Dismiss the question: nothing is sent, and the line that asked clears.
    ask.next(false);
    await page.locator("[data-cact='approve']").click();
    await waitFor(() => ask.seen.length === 1, "the confirm question");
    assert.match(ask.seen[0].message, /Approve this creative\? It will be marked approved for this partner\./);
    assert.match(ask.seen[0].message, /static · 16x9 · passed/, "the question names the creative that was picked");
    assert.deepEqual(log.actions, []);
    assert.equal(await text(page, "#actMsg"), "");
    // Accept it: the exact write for that creative and this partner, then what it is now.
    ask.next(true);
    await page.locator("[data-cact='approve']").click();
    await waitFor(() => log.actions.length === 1, "the approve request");
    assert.deepEqual(log.actions[0], { partner_id: P1, asset_id: A(4), action: "approve" });
    await waitFor(async () => /Done\. This creative is now approved\./.test(await text(page, "#actMsg")), "the done line");
    // The library was read again and shows the change.
    await waitFor(() => libraryReads() >= 2, "the library read again");
    await waitFor(async () => (await chips()).includes("approved2"), "two approved after the change");
    assert.match(await page.locator(`#libGrid .acard[data-asset='${A(4)}']`).getAttribute("class"), /st-approved/);

    // The server says no (archived): said in words, the screen does not claim it was done.
    const refused = await openFactory({ answers: { actions: () => ({ status: 400, body: { ok: false, error: "archived assets cannot be approved" } }) } });
    const ask2 = dialogs(refused.page);
    await refused.page.locator("#actAsset").selectOption(A(5));
    ask2.next(true);
    await refused.page.locator("[data-cact='approve']").click();
    await waitFor(async () => /^Could not approve it\./.test(await text(refused.page, "#actMsg")), "the refusal line");
    assert.doesNotMatch(await text(refused.page, "#actMsg"), /Done\./);
    await refused.page.close();

    // The second partner: the write names the second partner and the creative picked for it.
    const second = await openFactory({ query: `?partner_id=${P2}`, st: { usage: BOTH_ON() } });
    const ask3 = dialogs(second.page);
    await waitFor(async () => await second.page.locator("[data-cact='approve']").isEnabled(), "Approve enabled for the second partner");
    await second.page.locator("#actAsset").selectOption(A(6));
    ask3.next(true);
    await second.page.locator("[data-cact='approve']").click();
    await waitFor(() => second.log.actions.length === 1, "the second partner's approve");
    assert.deepEqual(second.log.actions[0], { partner_id: P2, asset_id: A(6), action: "approve" });
    await second.page.close();
  });

  await proof.check(/^Reject button \(asks to confirm/, async () => {
    await page.locator("#actAsset").selectOption(A(7));
    // Cancelled: nothing is sent.
    ask.next(false);
    await page.locator("[data-cact='reject']").click();
    await waitFor(() => ask.seen.length === 3, "the reject question");
    assert.match(ask.seen.at(-1).message, /Reject this creative\? It will be marked blocked and cannot be used\./);
    assert.match(ask.seen.at(-1).message, /video · 16x9 · pending/);
    assert.equal(log.actions.length, 1, "a dismissed question sends no reject");
    // Accepted: the exact write for the creative picked.
    ask.next(true);
    await page.locator("[data-cact='reject']").click();
    await waitFor(() => log.actions.length === 2, "the reject request");
    assert.deepEqual(log.actions[1], { partner_id: P1, asset_id: A(7), action: "reject" });
    await waitFor(async () => /Done\. This creative is now blocked\./.test(await text(page, "#actMsg")), "the done line");
    await waitFor(async () => (await chips()).includes("blocked3"), "three blocked after the change");
    assert.match(await page.locator(`#libGrid .acard[data-asset='${A(7)}']`).getAttribute("class"), /st-blocked/);
  });

  await proof.check(/^Archive button \(asks to confirm/, async () => {
    // A creative that is neither first nor last in the picker.
    await page.locator("#actAsset").selectOption(A(6));
    assert.equal(await page.locator(`#libGrid .acard[data-asset='${A(6)}']`).count(), 1, "it is in the library before");
    ask.next(false);
    await page.locator("[data-cact='archive']").click();
    await waitFor(() => ask.seen.length === 5, "the archive question");
    assert.match(ask.seen.at(-1).message, /Archive this creative\? It will be hidden from the library unless archived items are shown\./);
    assert.match(ask.seen.at(-1).message, /copy · 1x1 · passed/);
    assert.equal(log.actions.length, 2, "a dismissed question sends no archive");
    assert.equal(await page.locator(`#libGrid .acard[data-asset='${A(6)}']`).count(), 1, "nothing was hidden");
    ask.next(true);
    const reads = libraryReads();
    await page.locator("[data-cact='archive']").click();
    await waitFor(() => log.actions.length === 3, "the archive request");
    assert.deepEqual(log.actions[2], { partner_id: P1, asset_id: A(6), action: "archive" });
    await waitFor(async () => /Done\. This creative is now passed and archived\./.test(await text(page, "#actMsg")), "the done line");
    // Archive hides the creative: the library is read again and the card leaves it, and the picker
    // marks it archived.
    await waitFor(() => libraryReads() > reads, "the library read again");
    await waitFor(async () => (await page.locator(`#libGrid .acard[data-asset='${A(6)}']`).count()) === 0, "the archived card leaves the library");
    assert.equal(await page.locator("#libGrid .acard").count(), 7);
    assert.match(await page.locator(`#actAsset option[value='${A(6)}']`).innerText(), /archived/);
    // The ones that were not archived are still there.
    assert.equal(await page.locator(`#libGrid .acard[data-asset='${A(9)}']`).count(), 1);
    assert.equal(await page.locator(`#libGrid .acard[data-asset='${A(1)}']`).count(), 1);
  });
  await page.close();
});

test("Save this script, and the Script picker it feeds", { timeout: 90_000 }, async () => {
  const { page, log, st } = await openFactory();

  await proof.check(/^Script picker list on the Generate form/, async () => {
    const options = await page.locator("#genScript option").allInnerTexts();
    assert.deepEqual(options, ["— none —", "Denial angle · v2", "Your credit file is not your fault. It is a reco · v1"]);
    assert.deepEqual(readsFor(log, "scripts"), [P1]);
    // Switching partner rebuilds the list from that partner's scripts; the old pick does not carry over.
    await page.locator("#genScript").selectOption(S1);
    st.scripts = [{ id: S2, title: "Beta script", version: 1, body_preview: "b" }];
    await page.locator("#partnerSel").selectOption("1");
    await waitFor(() => readsFor(log, "scripts").includes(P2), "the second partner's scripts");
    await waitFor(async () => (await page.locator("#genScript option").allInnerTexts()).join("|") === "— none —|Beta script · v1", "the second list");
    assert.equal(await page.locator("#genScript").inputValue(), "");
    await page.locator("#partnerSel").selectOption("0");
    await waitFor(() => readsFor(log, "scripts").length >= 3, "the first partner again");
  });

  await proof.check(/^Save this script button/, async () => {
    st.scripts = SCRIPTS();
    // No words: said, nothing sent.
    await page.locator("#swSaveBtn").click();
    assert.equal(await text(page, "#swMsg"), "Type or paste the words of the ad first.");
    assert.deepEqual(log.scriptWrite, []);
    // Words and labels: only the filled boxes are sent, trimmed, with the partner.
    await page.locator("#swBody").fill("Banks said no. Here is why.");
    await page.locator("#swTitle").fill("  Denial angle  ");
    await page.locator("#swAngle").fill("Denial Angle");
    await page.locator("#swLane").selectOption("uwiq");
    await page.locator("#swSaveBtn").click();
    await waitFor(() => log.scriptWrite.length === 1, "the save request");
    assert.deepEqual(log.scriptWrite[0], { body: "Banks said no. Here is why.", title: "Denial angle", angle_key: "Denial Angle", lane: "uwiq", partner_id: P1 });
    // What it became is shown, the words box clears, and the script is picked in Generate.
    await waitFor(async () => /Saved as version 1 · labelled uwiq, denial_angle\. It is now in the Script list below\./.test(await text(page, "#swMsg")), "the saved line");
    assert.equal(await page.locator("#swBody").inputValue(), "");
    assert.equal(await page.locator("#genScript").inputValue(), "ee000000-0000-4000-8000-0000000000aa");
    assert.equal(await page.locator("#swAngleList option").first().getAttribute("value"), "denial_angle");
    // A refusal is shown as the endpoint wrote it.
    const refused = await openFactory({ answers: { scriptWrite: () => ({ status: 400, body: { ok: false, error: "label_invalid", message: "angle_key came out as \"3_second_hook\" after tidying, which is not a usable label." } }) } });
    await refused.page.locator("#swBody").fill("Some words");
    await refused.page.locator("#swAngle").fill("3 second hook");
    await refused.page.locator("#swSaveBtn").click();
    await waitFor(async () => /^Nothing was saved\. angle_key came out as/.test(await text(refused.page, "#swMsg")), "the refusal line");
    assert.equal(await refused.page.locator("#swBody").inputValue(), "Some words", "the words stay in the box");
    await refused.page.close();
  });
  await page.close();
});

test("Generation jobs: state chips, row detail, and the size select with its pager", { timeout: 90_000 }, async () => {
  const { page } = await openFactory();
  const rows = () => count(page, "#jobBody tr[data-job]");

  await proof.check(/^Generation jobs: state filter chips/, async () => {
    await page.locator("#jobLimit").selectOption("25");
    assert.equal(await rows(), 12);
    assert.deepEqual(await chipTexts(page, "#jobRail"), ["all12", "queued3", "running1", "succeeded5", "failed3"]);
    await page.locator("#jobRail [data-js='failed']").click();
    assert.equal(await rows(), 3);
    assert.equal(await page.locator("#jobRail [data-js='failed']").getAttribute("class"), "on");
    // Several at once: queued and failed together.
    await page.locator("#jobRail [data-js='queued']").click();
    assert.equal(await rows(), 6);
    const statuses = (await page.locator("#jobBody tr[data-job] .badge").allInnerTexts()).map((s) => s.toLowerCase());
    assert.ok(statuses.every((s) => s === "queued" || s === "failed"), statuses.join(","));
    // Press one again to drop it; all clears the filter.
    await page.locator("#jobRail [data-js='failed']").click();
    assert.equal(await rows(), 3);
    await page.locator("#jobRail [data-js='']").click();
    assert.equal(await rows(), 12);
    assert.equal(await page.locator("#jobRail [data-js='']").getAttribute("class"), "on");
    // The retrying job says so.
    assert.match(await text(page, "#jobBody"), /retrying · attempt 1/);
  });

  await proof.check(/^Generation jobs: 'show' size select and prev \/ next pager/, async () => {
    await page.locator("#jobLimit").selectOption("5");
    assert.equal(await rows(), 5);
    assert.equal(await page.locator("#jobPager [data-mv='-1']").isDisabled(), true);
    assert.equal(await page.locator("#jobPager [data-mv='1']").isEnabled(), true);
    const first = await page.locator("#jobBody tr[data-job]").first().getAttribute("data-job");
    await page.locator("#jobPager [data-mv='1']").click();
    assert.equal(await rows(), 5);
    assert.notEqual(await page.locator("#jobBody tr[data-job]").first().getAttribute("data-job"), first);
    await page.locator("#jobPager [data-mv='1']").click();
    assert.equal(await rows(), 2, "the last page holds the rest");
    assert.equal(await page.locator("#jobPager [data-mv='1']").isDisabled(), true);
    await page.locator("#jobPager [data-mv='-1']").click();
    await page.locator("#jobPager [data-mv='-1']").click();
    assert.equal(await page.locator("#jobBody tr[data-job]").first().getAttribute("data-job"), first);
    // A filter puts the pager back at the start.
    await page.locator("#jobPager [data-mv='1']").click();
    await page.locator("#jobRail [data-js='succeeded']").click();
    assert.equal(await page.locator("#jobPager [data-mv='-1']").isDisabled(), true);
    await page.locator("#jobRail [data-js='']").click();

    // So does the size select: from page two it lands on the first page of the new size, with that
    // size's rows, not on an empty or half page.
    const idsOf = () => page.locator("#jobBody tr[data-job]").evaluateAll((els) => els.map((e) => e.dataset.job));
    assert.deepEqual(await idsOf(), [1, 2, 3, 4, 5].map(J), "page one at size five");
    await page.locator("#jobPager [data-mv='1']").click();
    assert.deepEqual(await idsOf(), [6, 7, 8, 9, 10].map(J), "page two at size five holds the next five jobs");
    await page.locator("#jobLimit").selectOption("10");
    assert.deepEqual(await idsOf(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(J), "a new size starts again at the first job");
    assert.equal(await page.locator("#jobPager [data-mv='-1']").isDisabled(), true);
    assert.equal(await page.locator("#jobPager [data-mv='1']").isEnabled(), true, "two more jobs wait on the next page");
    await page.locator("#jobPager [data-mv='1']").click();
    assert.deepEqual(await idsOf(), [11, 12].map(J));
    await page.locator("#jobLimit").selectOption("25");
    assert.equal(await rows(), 12, "size 25 shows all twelve from the first");
    await page.locator("#jobLimit").selectOption("5");
  });

  await proof.check(/^Generation jobs: row click expands job detail/, async () => {
    await page.locator("#jobLimit").selectOption("25");
    const detailOf = async (n) => {
      const row = page.locator(`#jobBody tr[data-job='${J(n)}']`);
      if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
      const det = page.locator(`#jobBody tr[data-job='${J(n)}'] + tr.det`);
      assert.equal(await det.count(), 1, `job ${n} expanded`);
      const pairs = await det.locator(".detcol").evaluateAll((els) => els.map((e) => [e.querySelector(".dk").textContent, e.querySelector(".dv").textContent]));
      return { det, pairs, errbox: (await det.locator(".errbox").count()) ? await det.locator(".errbox").innerText() : null, text: await det.innerText() };
    };
    // A failed job with a brand kit: every field is the job's own.
    const failed = await detailOf(10);
    assert.deepEqual(failed.pairs, [
      ["Job reference", J(10)], ["Batch name", "batch-10"], ["Brand kit", "Kit 2"],
      ["Started", stamp(iso(100))], ["Finished", stamp(iso(99))], ["Creatives made", "0"]
    ]);
    assert.match(failed.text, /what went wrong/i);
    assert.equal(failed.errbox, "No ad-making service is switched on for this account, so there was nothing to make the work. Trying again will not help.");
    assert.match(failed.text, /No vendor is switched on\. Trying again will not help\./);
    // The detail never prints the engineer's sentence or a table name.
    assert.doesNotMatch(failed.text, /creative_providers|no active provider configured/);
    assert.equal(await page.locator(`#jobBody tr[data-job='${J(10)}']`).getAttribute("aria-expanded"), "true");
    // A second press closes it; Enter opens it again from the keyboard.
    await page.locator(`#jobBody tr[data-job='${J(10)}']`).click();
    assert.equal(await page.locator(`#jobBody tr[data-job='${J(10)}'] + tr.det`).count(), 0);
    await page.locator(`#jobBody tr[data-job='${J(11)}']`).focus();
    await page.keyboard.press("Enter");
    const empty = await detailOf(11);
    assert.equal(empty.errbox, "The ad-making service answered, but sent nothing back.");
    assert.match(empty.text, /The vendor returned nothing\./);
    assert.deepEqual(empty.pairs.slice(0, 3), [["Job reference", J(11)], ["Batch name", "batch-11"], ["Brand kit", "—"]], "no kit reads as a dash");
    // An error nobody put into words says so rather than guessing.
    const unknown = await detailOf(12);
    assert.equal(unknown.errbox, "The job stopped with an error that this screen cannot put into plain words. Nothing was made.");
    assert.doesNotMatch(unknown.text, /socket hang up/);
    assert.match(unknown.text, /Stopped after three tries\./);
    // A succeeded job says how many creatives it stored, which kit it used, and has no error box.
    const done = await detailOf(7);
    assert.deepEqual(done.pairs, [
      ["Job reference", J(7)], ["Batch name", "batch-7"], ["Brand kit", "Kit 1"],
      ["Started", stamp(iso(70))], ["Finished", stamp(iso(69))], ["Creatives made", "1"]
    ]);
    assert.equal(done.errbox, null);
    assert.match(done.text, /Succeeded\. 1 asset stored\./);
    // A job still waiting shows no start or finish time, and the retry carries its own error words.
    const waiting = await detailOf(1);
    assert.deepEqual(waiting.pairs.slice(3), [["Started", "—"], ["Finished", "—"], ["Creatives made", "2"]]);
    assert.match(waiting.text, /Waiting to start\./);
    const retry = await detailOf(3);
    assert.equal(retry.errbox, "The ad-making service answered, but sent nothing back.");
    assert.match(retry.text, /Retrying\. Tried 1 time\. Failed after three tries\./);
    // The running job.
    const running = await detailOf(4);
    assert.match(running.text, /Running\. Attempt 1\./);
    assert.deepEqual(running.pairs.slice(3, 5), [["Started", stamp(iso(40))], ["Finished", "—"]]);
  });
  await page.close();
});

test("Creative library: filters, pager, the detail drawer and its three ways out", { timeout: 120_000 }, async () => {
  const { page } = await openFactory();
  const cards = () => count(page, "#libGrid .acard");
  const ids = () => page.locator("#libGrid .acard").evaluateAll((els) => els.map((e) => e.dataset.asset));
  const want = (...ns) => ns.map(A);
  await page.locator("#libLimit").selectOption("6");

  // Back to the unfiltered library at size six: page one holds six, page two the other two.
  const cleanSlate = async () => {
    await page.locator("#libStateRail [data-ls='all']").click();
    await page.locator("#libKindRail [data-lk='']").click();
    await page.locator("#libFormatRail [data-lf='']").click();
    await page.locator("#libKit").selectOption("");
    await page.locator("#libArch").selectOption("");
    await page.locator("#libLimit").selectOption("6");
  };

  await proof.check(/^Creative library: state chips, kind chips/, async () => {
    await page.locator("#libLimit").selectOption("50");
    assert.equal(await cards(), 8, "archived creatives are hidden by default");
    assert.deepEqual(await chipTexts(page, "#libStateRail"), ["all8", "pending2", "passed3", "blocked2", "approved1"]);
    assert.deepEqual(await chipTexts(page, "#libKindRail"), ["any8", "static4", "video2", "copy2"]);
    assert.deepEqual(await chipTexts(page, "#libFormatRail"), ["any8", "1x1", "4x5", "9x16", "16x9"].map((t, i) => (i === 0 ? t : `${t}${[2, 2, 2, 2][i - 1]}`)));
    // Narrow together: state and kind, then format.
    await page.locator("#libStateRail [data-ls='blocked']").click();
    assert.deepEqual(await ids(), want(2, 8));
    await page.locator("#libKindRail [data-lk='copy']").click();
    assert.deepEqual(await ids(), want(2), "state and kind narrow together");
    await page.locator("#libStateRail [data-ls='all']").click();
    assert.deepEqual(await ids(), want(2, 6));
    await page.locator("#libFormatRail [data-lf='4x5']").click();
    assert.deepEqual(await ids(), want(2));
    await page.locator("#libKindRail [data-lk='']").click();
    assert.deepEqual(await ids(), want(2, 8), "static and copy at 4x5");
    await page.locator("#libFormatRail [data-lf='']").click();
    // Nothing matches: it says so.
    await page.locator("#libStateRail [data-ls='approved']").click();
    await page.locator("#libKindRail [data-lk='copy']").click();
    assert.equal(await cards(), 0);
    assert.match(await text(page, "#libGrid"), /No assets match this filter for this partner\./);
    await cleanSlate();
    await page.locator("#libLimit").selectOption("50");
    await page.locator("#libStateRail [data-ls='all']").click();
    await page.locator("#libKindRail [data-lk='']").click();

    // Every value of every control, pressed from the second page: it has to land on the first page of
    // what that control picks, holding exactly those creatives. A filter that kept the old page
    // position would show an empty page here.
    const fromPageTwo = async (label, press, expected) => {
      await cleanSlate();
      assert.deepEqual(await ids(), want(1, 2, 3, 4, 6, 7), `${label}: page one before`);
      await page.locator("#libPager [data-mv='1']").click();
      assert.deepEqual(await ids(), want(8, 9), `${label}: page two before`);
      await press();
      assert.deepEqual(await ids(), expected, label);
    };
    const state = (k) => () => page.locator(`#libStateRail [data-ls='${k}']`).click();
    const kind = (k) => () => page.locator(`#libKindRail [data-lk='${k}']`).click();
    const format = (k) => () => page.locator(`#libFormatRail [data-lf='${k}']`).click();
    await fromPageTwo("state pending", state("pending"), want(1, 7));
    await fromPageTwo("state passed", state("passed"), want(4, 6, 9));
    await fromPageTwo("state blocked", state("blocked"), want(2, 8));
    await fromPageTwo("state approved", state("approved"), want(3));
    await fromPageTwo("kind static", kind("static"), want(1, 4, 8, 9));
    await fromPageTwo("kind video", kind("video"), want(3, 7));
    await fromPageTwo("kind copy", kind("copy"), want(2, 6));
    await fromPageTwo("format 1x1", format("1x1"), want(1, 6));
    await fromPageTwo("format 4x5", format("4x5"), want(2, 8));
    await fromPageTwo("format 9x16", format("9x16"), want(3, 9));
    await fromPageTwo("format 16x9", format("16x9"), want(4, 7));
    await fromPageTwo("brand kit one", () => page.locator("#libKit").selectOption(K1), want(1, 2, 4, 7, 9));
    await fromPageTwo("brand kit two", () => page.locator("#libKit").selectOption(K2), want(3, 6, 8));
    await fromPageTwo("include archived", () => page.locator("#libArch").selectOption("1"), want(1, 2, 3, 4, 5, 6));
    await fromPageTwo("size twelve", () => page.locator("#libLimit").selectOption("12"), want(1, 2, 3, 4, 6, 7, 8, 9));
    // Include archived adds the archived one, and No takes it away again.
    await cleanSlate();
    await page.locator("#libLimit").selectOption("50");
    await page.locator("#libArch").selectOption("1");
    assert.equal(await cards(), 9);
    assert.ok((await ids()).includes(A(5)));
    await page.locator("#libArch").selectOption("");
    assert.equal(await cards(), 8);
    await cleanSlate();
  });

  await proof.check(/^Creative library: asset card click opens the detail drawer; prev \/ next pager/, async () => {
    await cleanSlate();
    assert.deepEqual(await ids(), want(1, 2, 3, 4, 6, 7));
    assert.equal(await page.locator("#libPager [data-mv='-1']").isDisabled(), true);
    await page.locator("#libPager [data-mv='1']").click();
    assert.deepEqual(await ids(), want(8, 9), "page two holds the rest");
    assert.equal(await page.locator("#libPager [data-mv='1']").isDisabled(), true);
    // A card on the second page opens its own creative.
    await page.locator(`#libGrid .acard[data-asset='${A(9)}']`).click();
    assert.equal(await drawerOpen(page), true);
    assert.match(await text(page, "#dwBody"), new RegExp(A(9)));
    await page.keyboard.press("Escape");
    await page.locator("#libPager [data-mv='-1']").click();
    assert.deepEqual(await ids(), want(1, 2, 3, 4, 6, 7), "back to page one");
    // Clicking a card opens that card's drawer with the words, the flags and why it was stopped.
    await page.locator(`#libGrid .acard[data-asset='${A(2)}']`).click();
    assert.equal(await drawerOpen(page), true);
    assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"), "false");
    const body = await text(page, "#dwBody");
    assert.match(body, new RegExp(A(2)), "the drawer is for the card that was pressed");
    assert.match(body, /Working capital for owners, guaranteed approval\./);
    assert.match(body, /Guaranteed approval cannot be advertised\./);
    assert.match(body, /reference: guaranteed-approval/);
    assert.match(await text(page, "#dwTitle"), /^copy · 4x5 · cc000000/);
  });

  await proof.check(/^Detail drawer: close button, scrim click, Esc key/, async () => {
    assert.equal(await drawerOpen(page), true);
    await page.locator("#dwClose").click();
    assert.equal(await drawerOpen(page), false);
    assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"), "true");
    await page.locator(`#libGrid .acard[data-asset='${A(3)}']`).click();
    assert.equal(await drawerOpen(page), true);
    await page.locator("#scrim").click({ position: { x: 500, y: 400 } });
    assert.equal(await drawerOpen(page), false, "the scrim closes it");
    await page.locator(`#libGrid .acard[data-asset='${A(3)}']`).click();
    assert.equal(await drawerOpen(page), true);
    await page.keyboard.press("Escape");
    assert.equal(await drawerOpen(page), false, "Esc closes it");
    // The video says it has a performer and a length.
    await page.locator(`#libGrid .acard[data-asset='${A(3)}']`).click();
    assert.match(await text(page, "#dwBody"), /synthetic performer[\s\S]*yes/i);
    assert.match(await text(page, "#dwBody"), /22s/);
    await page.keyboard.press("Escape");
  });
  await page.close();
});

test("Review queue and Brand kits: chips, size select, pager, row detail", { timeout: 120_000 }, async () => {
  const { page, log } = await openFactory();
  const rows = () => count(page, "#apprBody tr[data-appr]");

  await proof.check(/^Review queue: state chips/, async () => {
    assert.deepEqual(await chipTexts(page, "#apprRail"), ["all4", "blocked1", "pending1", "awaiting_approval2"]);
    assert.equal(await rows(), 4);
    await page.locator("#apprRail [data-as='blocked']").click();
    assert.equal(await rows(), 1);
    await page.locator("#apprRail [data-as='awaiting_approval']").click();
    assert.equal(await rows(), 2, "a campaign and a brand wait on a person");
    assert.match(await text(page, "#apprBody"), /Campaign/);
    assert.match(await text(page, "#apprBody"), /Brand/);
    await page.locator("#apprRail [data-as='all']").click();
    // Row detail: a blocked creative lists its reasons; a campaign lists its checks and budget.
    await page.locator(`#apprBody tr[data-appr='${A(2)}']`).click();
    const detail = page.locator(`#apprBody tr[data-appr='${A(2)}'] + tr.det`);
    assert.match(await detail.innerText(), /Guaranteed approval cannot be advertised\./);
    await page.locator(`#apprBody tr[data-appr='${CAMPAIGN}']`).click();
    const campaign = await page.locator(`#apprBody tr[data-appr='${CAMPAIGN}'] + tr.det`).innerText();
    assert.match(campaign, /\$1,500\.00/);
    assert.match(campaign, /waiting for a person/i);
    assert.match(campaign, /This partner has approve_before_launch enabled\./);
  });

  await proof.check(/^Review queue: 'Open the full creative' button on a row/, async () => {
    // The blocked copy ad is the second creative in the library and the first row in the queue, so
    // opening "the first creative of the library" and "the one on this row" are different things.
    const expand = async (id) => {
      const row = page.locator(`#apprBody tr[data-appr='${id}']`);
      if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
    };
    await expand(A(2));
    const open = page.locator(`#apprBody tr[data-appr='${A(2)}'] + tr.det [data-open-asset]`);
    assert.equal(await open.count(), 1);
    assert.equal(await drawerOpen(page), false);
    await open.click();
    assert.equal(await drawerOpen(page), true);
    assert.match(await text(page, "#dwTitle"), /^copy · 4x5 · cc000000/);
    assert.match(await text(page, "#dwBody"), new RegExp(A(2)), "the drawer is for the row that was pressed");
    assert.match(await text(page, "#dwBody"), /review state[\s\S]*blocked/i);
    assert.match(await text(page, "#dwBody"), /Working capital for owners, guaranteed approval\./);
    await page.keyboard.press("Escape");
    // A second row opens its own creative, not the first row's.
    await expand(A(1));
    await page.locator(`#apprBody tr[data-appr='${A(1)}'] + tr.det [data-open-asset]`).click();
    assert.equal(await drawerOpen(page), true);
    assert.match(await text(page, "#dwTitle"), /^static · 1x1 · cc000000/);
    assert.match(await text(page, "#dwBody"), new RegExp(A(1)));
    assert.match(await text(page, "#dwBody"), /review state[\s\S]*pending/i);
    // The row stays open under the drawer; the campaign and brand rows have no such button.
    await page.keyboard.press("Escape");
    await expand(CAMPAIGN);
    assert.equal(await page.locator(`#apprBody tr[data-appr='${CAMPAIGN}'] + tr.det`).count(), 1);
    assert.equal(await page.locator(`#apprBody tr[data-appr='${CAMPAIGN}'] + tr.det [data-open-asset]`).count(), 0);
  });

  await proof.check(/^Review queue: state chips \(all, blocked, pending, awaiting_approval\), 'show' size select/, async () => {
    // Twelve rows, so the size select and the pager have something to do.
    const big = await openFactory({ st: { approvals: APPROVALS_BIG() } });
    const ids = () => big.page.locator("#apprBody tr[data-appr]").evaluateAll((els) => els.map((e) => e.dataset.appr));
    const prev = big.page.locator("#apprPager [data-mv='-1']");
    const next = big.page.locator("#apprPager [data-mv='1']");
    assert.deepEqual(await chipTexts(big.page, "#apprRail"), ["all12", "blocked5", "pending5", "awaiting_approval2"]);
    // Newest first: the four known rows, then the extra creatives by their updated time.
    const everything = [A(2), A(1), CAMPAIGN, BRAND, ...Array.from({ length: 8 }, (_, i) => A(20 + i))];
    assert.deepEqual(await ids(), everything.slice(0, 10), "size ten shows the first ten");
    await big.page.locator("#apprLimit").selectOption("5");
    assert.deepEqual(await ids(), everything.slice(0, 5));
    assert.equal(await prev.isDisabled(), true);
    assert.equal(await next.isEnabled(), true);
    await next.click();
    assert.deepEqual(await ids(), everything.slice(5, 10), "next shows the next five, not the same five");
    assert.equal(await prev.isEnabled(), true);
    await next.click();
    assert.deepEqual(await ids(), everything.slice(10), "the last page holds the rest");
    assert.equal(await next.isDisabled(), true);
    await prev.click();
    await prev.click();
    assert.deepEqual(await ids(), everything.slice(0, 5), "prev walks back to the first five");
    // From page two, a new size starts again at the first row.
    await next.click();
    assert.deepEqual(await ids(), everything.slice(5, 10));
    await big.page.locator("#apprLimit").selectOption("10");
    assert.deepEqual(await ids(), everything.slice(0, 10), "a new size starts at the first row");
    assert.equal(await prev.isDisabled(), true);
    // From page two, a state chip also starts at the first row of what it picks.
    await big.page.locator("#apprLimit").selectOption("5");
    await next.click();
    assert.deepEqual(await ids(), everything.slice(5, 10));
    await big.page.locator("#apprRail [data-as='blocked']").click();
    assert.deepEqual(await ids(), [A(2), A(21), A(23), A(25), A(27)], "blocked rows, newest first, from the first");
    assert.equal(await prev.isDisabled(), true);
    await big.page.locator("#apprRail [data-as='awaiting_approval']").click();
    assert.deepEqual(await ids(), [CAMPAIGN, BRAND]);
    await big.page.close();
  });

  await proof.check(/^Brand kits: state chips, kit card click opens drawer, prev \/ next/, async () => {
    const names = () => page.locator("#kitGrid .kit .kn").allInnerTexts();
    const prev = page.locator("#kitPager [data-mv='-1']");
    const next = page.locator("#kitPager [data-mv='1']");
    assert.deepEqual(await chipTexts(page, "#kitRail"), ["all7", "draft2", "active3", "archived2"]);
    assert.deepEqual(await names(), ["Kit 1", "Kit 2", "Kit 3", "Kit 4", "Kit 5", "Kit 6"], "six kits to a page");
    assert.equal(await prev.isDisabled(), true);
    await next.click();
    assert.deepEqual(await names(), ["Kit 7"], "the next page holds the seventh kit, not the first again");
    assert.equal(await next.isDisabled(), true);
    // The seventh kit opens as itself.
    await page.locator("#kitGrid .kit").first().click();
    assert.equal(await drawerOpen(page), true);
    assert.equal(await text(page, "#dwTitle"), "Kit 7");
    await page.keyboard.press("Escape");
    // From page two, every state chip goes back to the first page of what it picks.
    await page.locator("#kitRail [data-ks='draft']").click();
    assert.deepEqual(await names(), ["Kit 3", "Kit 4"], "draft kits only, from the first");
    await next.isDisabled();
    await page.locator("#kitRail [data-ks='all']").click();
    await next.click();
    await page.locator("#kitRail [data-ks='active']").click();
    assert.deepEqual(await names(), ["Kit 1", "Kit 2", "Kit 7"]);
    await page.locator("#kitRail [data-ks='archived']").click();
    assert.deepEqual(await names(), ["Kit 5", "Kit 6"]);
    await page.locator("#kitRail [data-ks='all']").click();
    // A card that is not the first opens its own kit.
    await page.locator(`#kitGrid .kit[data-kit='${K2}']`).click();
    assert.equal(await drawerOpen(page), true);
    assert.equal(await text(page, "#dwTitle"), "Kit 2");
    const body = await text(page, "#dwBody");
    assert.match(body, /name[\s\S]*kit 2/i);
    assert.match(body, new RegExp(K2));
    assert.match(body, /plain and direct/i);
    assert.match(body, /working capital/i);
    assert.match(await text(page, "#dwEyebrow"), /brand kit/i);
    await page.keyboard.press("Escape");
    await page.locator("#kitGrid .kit").nth(3).click();
    assert.equal(await text(page, "#dwTitle"), "Kit 4");
    await page.keyboard.press("Escape");
    assert.equal(log.reads.filter(([n]) => n === "kits").length, 1, "the chips filter in the page and read nothing new");
  });

  await proof.check(/^Reference section/, async () => {
    const summaries = await page.locator(".scopebar summary").allInnerTexts();
    assert.deepEqual(summaries, ["What each job state means", "How the AI labels are decided", "Why creative gets stopped", "Settings the creative engine ships with"]);
    assert.deepEqual(await page.locator(".scopebar").evaluateAll((els) => els.map((e) => e.open)), [false, false, false, false], "all four start closed");
    // Each one opens and shows its own table or counts.
    await page.locator(".scopebar summary", { hasText: "What each job state means" }).click();
    await page.locator(".scopebar summary", { hasText: "How the AI labels are decided" }).click();
    await page.locator(".scopebar summary", { hasText: "Why creative gets stopped" }).click();
    await page.locator(".scopebar summary", { hasText: "Settings the creative engine ships with" }).click();
    assert.deepEqual(await page.locator(".scopebar").evaluateAll((els) => els.map((e) => e.open)), [true, true, true, true]);

    // 1. The job states: five cards, each with the number of jobs read in that state and its words.
    const legend = await page.locator("#stateLegend button").evaluateAll((els) => els.map((e) => [e.querySelector(".an").textContent, e.querySelector(".at").textContent, e.querySelector(".ad").textContent]));
    assert.deepEqual(legend, [
      ["2", "Queued", "Waiting to start."],
      ["1", "Retrying", "Tried before and waiting to try again. Up to three tries."],
      ["1", "Running", "In progress now."],
      ["5", "Succeeded", "At least one creative was stored."],
      ["3", "Failed", "Stopped. Always has a reason."]
    ]);
    assert.match(await page.locator(".scopebar").nth(0).locator(".st").innerText(), /A job is tried up to three times\./);
    // "Three" is the real limit: the job service stops after three tries.
    assert.match(read("src/creative/generate.mjs"), /const DEFAULT_MAX_ATTEMPTS = 3;/);

    // 2. The AI labels: five rows, one for each vendor kind the code has, and each row's words are what
    // that vendor's code does with the two labels.
    const flags = await page.locator("#flagBody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())));
    assert.deepEqual(flags, [
      ["static", "always", "depends", "Always marked AI-generated. A synthetic person is marked only when one was asked for."],
      ["ugc-video", "always", "always", "Always marked as showing a synthetic person, and therefore also AI-generated."],
      ["product-video", "always", "usually not", "Always marked AI-generated. Treated as having no synthetic person unless the request says otherwise."],
      ["copy", "always", "never", "Written copy is always machine-made and never has a performer."],
      ["resize", "same as original", "same as original", "Both labels are copied from the original creative."]
    ]);
    assert.deepEqual(flags.map((r) => r[0]).sort(), [...PROVIDER_KEYS].sort(), "one row for every vendor kind the code knows");
    const code = (name) => read(`src/creative/providers/${name}.mjs`);
    assert.match(code("static"), /aiGenerated: true,[\s\S]*?syntheticPerformer: Boolean\(spec\.syntheticPerformer\)/, "static: always AI, performer depends on the request");
    assert.match(code("ugc-video"), /aiGenerated: true,[\s\S]*?syntheticPerformer: true,/, "ugc-video: always AI, always a performer");
    assert.match(code("product-video"), /aiGenerated: true,[\s\S]*?syntheticPerformer: Boolean\(spec\.syntheticPerformer\)/, "product-video: always AI, performer only when asked");
    assert.match(code("copy"), /aiGenerated: true,\s*syntheticPerformer: false/, "copy: always AI, never a performer");
    assert.match(code("resize"), /aiGenerated: parent\.ai_generated !== false,\s*syntheticPerformer: Boolean\(parent\.synthetic_performer\)/, "resize: both labels from the original");

    // 3. Why creative gets stopped: 29 reasons, two of which hold the work for a person. The list is
    // checked against the code that stops creative, and the numbers in the words against the list.
    const reasons = await page.locator(".scopebar").nth(2).locator(".st").first().innerText();
    assert.match(reasons, /There are 29 reasons\. 27 of them stop the work outright\./);
    assert.equal(await count(page, "#ruleBody tr"), 29, "29 reasons listed");
    assert.equal(await count(page, "#ruleBody tr.stripe-info"), 2, "two of them hold the work for a person");
    await page.locator(".scopebar summary", { hasText: "Why creative gets stopped" }).click();
    assert.equal(await page.locator(".scopebar").nth(2).evaluate((e) => e.open), false, "a second press closes it again");
    // The list is hand-copied, so tie it to the code that stops creative: every reason the page lists
    // is one the engine can raise, and every reason the engine can raise is on the page.
    const listed = await page.locator("#ruleBody tr").evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll("td")[1].querySelector("span.sub:last-child").textContent));
    const seeded = [...read("db/migrations/047_compliance_rules.sql").matchAll(/^\s*\('([a-z]+)',\s*'([a-z0-9-]+)',\s*'\[/gm)].map((m) => m[2]);
    const screen = read("src/compliance/screen.mjs");
    const engine = [...screen.matchAll(/\b(?:r|blocked)\(\s*"([a-z_]+)"/g)].map((m) => m[1]).concat([...screen.matchAll(/code:\s*"([a-z_]+)"/g)].map((m) => m[1]));
    const targeting = [...read("src/compliance/targeting.mjs").matchAll(/reason\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    const real = [...new Set([...seeded, ...engine, ...targeting])].sort();
    assert.equal(real.length, 29, "the code raises 29 different reasons");
    assert.deepEqual([...new Set(listed)].sort(), real, "the page lists exactly the reasons the code can raise");

    // 4. Settings the engine ships with: a typed-in snapshot (the page says so itself), so each row is
    // checked word for word, and every number in it is tied to the migration it was copied from.
    assert.match(await page.locator(".scopebar").nth(3).locator(".st").first().innerText(), /not read back from the running system/);
    const settings = await page.locator("#gapsBody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())));
    assert.deepEqual(settings, [
      ["Meta ad category", "Special ad category per offer type", "3", "Using a default of CREDIT — confirm it", "Meta rejects the campaign if this is wrong"],
      ["Creative vendors", "Which vendor makes each kind of creative", "0", "Not set — generation cannot run", "Nothing can be generated until a vendor is switched on"],
      ["Generation markup", "Marked up 100%", "0", "Placeholder — not signed off", "Do not put this on an invoice until someone approves it"],
      ["Managed spend rate", "10% of spend", "0", "Placeholder — not signed off", "Do not put this on an invoice until someone approves it"],
      ["Kill ads with no conversions", "Pause when an ad spends $500 with zero conversions.", "0", "Using a built-in default", "Active on a default, not a measured figure"],
      ["Refresh by spend tier", "How often new creative is asked for, by daily spend.", "0", "Using a built-in default", "Active on a default, not a measured figure"],
      ["Protect budget when return is on target", "When return is at or above target, spend rules may queue creative but must not cut budget.", "0", "Using a built-in default", "Active on a default, not a measured figure"]
    ]);
    const mig = read("db/migrations/052_config_defaults.sql");
    assert.match(mig, /CROSS JOIN \(VALUES \('funding'\), \('credit_cards'\), \('credit_repair'\)\) AS v\(offer\)/, "three offer types get a Meta category");
    assert.match(mig, /'meta', v\.offer, 'CREDIT'/, "and the category is CREDIT");
    assert.match(mig, /SET rate = 100,[\s\S]*?WHERE rate_key = 'generation_markup_pct'/, "the markup is 100");
    assert.match(mig, /SET rate = 10,[\s\S]*?WHERE rate_key = 'managed_spend_pct'/, "the managed spend rate is 10");
    assert.match(mig, /signed_off_at is NULL and v_creative_config_gaps reports it/, "both rates are unsigned placeholders");
    assert.match(mig, /jsonb_set\(params, '\{spend_floor_cents\}', '50000'\)[\s\S]*?WHERE rule_key = 'kill_no_conversions'/, "the kill floor is 50000 cents, $500");
    assert.match(mig, /WHERE rule_key = 'spend_tier_refresh'/);
    assert.match(mig, /jsonb_set\(params, '\{target_roas\}', '1\.0'\)[\s\S]*?WHERE rule_key = 'roas_primary'/);
    // The view the table was copied from has exactly these arms, with these status meanings.
    assert.match(mig, /rr\.rule_key IN \('kill_no_conversions', 'spend_tier_refresh', 'roas_primary'\)/);
    assert.match(mig, /'UNSET — generation cannot run'/);
    assert.match(mig, /'DEFAULTED in 052 to CREDIT — confirm against your Marketing API version'/);
    assert.match(mig, /'PLACEHOLDER set in 052 — AWAITING SIGN-OFF'/);
    assert.match(mig, /'DEFAULTED in 052 — derived, tunable'/);
  });
  await page.close();
});

test("the brand row in the review queue: Approve, and Send it back with a required reason", { timeout: 90_000 }, async () => {
  const { page, log } = await openFactory();
  const ask = dialogs(page);
  await page.locator(`#apprBody tr[data-appr='${BRAND}']`).click();
  const box = page.locator(`#apprBody tr[data-appr='${BRAND}'] + tr.det [data-brand-box]`);
  assert.equal(await box.count(), 1, "an owner gets the two buttons");

  await proof.check(/^Review queue \(brand row\): 'Send it back' button with required reason/, async () => {
    // No reason: said, nothing asked, nothing sent.
    await box.locator("[data-brand-act='reject']").click();
    assert.equal(await box.locator("[data-brand-msg]").innerText(), "Type a reason first — it is kept with the brand.");
    assert.equal(ask.seen.length, 0);
    assert.deepEqual(log.brand, []);
    // A reason, but the confirm is dismissed: nothing sent.
    await box.locator("[data-brand-note]").fill("  Use the full business name.  ");
    ask.next(false);
    await box.locator("[data-brand-act='reject']").click();
    await waitFor(() => ask.seen.length === 1, "the confirm question");
    assert.match(ask.seen[0].message, /Send this brand back\? It becomes a draft again and leaves the queue\./);
    assert.deepEqual(log.brand, []);
    // Accepted: the exact write, trimmed, and the queue is read again.
    ask.next(true);
    await box.locator("[data-brand-act='reject']").click();
    await waitFor(() => log.brand.length === 1, "the send-back request");
    assert.deepEqual(log.brand[0], { partner_id: P1, action: "reject", note: "Use the full business name." });
    await waitFor(() => readsFor(log, "approvals").length >= 2, "the queue read again");
  });

  await proof.check(/^Review queue \(brand row\): reason box and 'Approve this brand' button/, async () => {
    await page.locator(`#apprBody tr[data-appr='${BRAND}']`).click();
    const again = page.locator(`#apprBody tr[data-appr='${BRAND}'] + tr.det [data-brand-box]`);
    ask.next(true);
    await again.locator("[data-brand-act='approve']").click();
    await waitFor(() => log.brand.length === 2, "the approve request");
    assert.deepEqual(log.brand[1], { partner_id: P1, action: "approve" }, "approve sends no reason");
    assert.match(ask.seen.at(-1).message, /Approve this brand\? It will be marked approved for this partner\./);
    await page.close();

    // With the second partner on screen, both buttons act on the second partner.
    const second = await openFactory({ query: `?partner_id=${P2}` });
    const ask4 = dialogs(second.page);
    await second.page.locator(`#apprBody tr[data-appr='${BRAND}']`).click();
    const box4 = second.page.locator(`#apprBody tr[data-appr='${BRAND}'] + tr.det [data-brand-box]`);
    ask4.next(true);
    await box4.locator("[data-brand-act='approve']").click();
    await waitFor(() => second.log.brand.length === 1, "the second partner's approve");
    assert.deepEqual(second.log.brand[0], { partner_id: P2, action: "approve" });
    // The queue is read again after the change, so the row is drawn fresh and opened again.
    await waitFor(() => readsFor(second.log, "approvals").length >= 2, "the queue read again");
    await waitFor(async () => (await second.page.locator(`#apprBody tr[data-appr='${BRAND}']`).count()) === 1, "the brand row drawn again");
    await second.page.locator(`#apprBody tr[data-appr='${BRAND}']`).click();
    const box5 = second.page.locator(`#apprBody tr[data-appr='${BRAND}'] + tr.det [data-brand-box]`);
    await box5.locator("[data-brand-note]").fill("Needs the legal name");
    ask4.next(true);
    await box5.locator("[data-brand-act='reject']").click();
    await waitFor(() => second.log.brand.length === 2, "the second partner's send back");
    assert.deepEqual(second.log.brand[1], { partner_id: P2, action: "reject", note: "Needs the legal name" });
    await second.page.close();

    // The server refuses: said in words, never the code. 403 and 409 each read differently.
    const refused = await openFactory({ answers: { brand: () => ({ status: 403, body: { ok: false, error: "forbidden" } }) } });
    const ask2 = dialogs(refused.page);
    await refused.page.locator(`#apprBody tr[data-appr='${BRAND}']`).click();
    const box2 = refused.page.locator(`#apprBody tr[data-appr='${BRAND}'] + tr.det [data-brand-box]`);
    ask2.next(true);
    await box2.locator("[data-brand-act='approve']").click();
    await waitFor(async () => /This sign-in is not allowed to approve a brand\. Nothing was changed\./.test(await box2.locator("[data-brand-msg]").innerText()), "the 403 words");
    await refused.page.close();

    // Not owner or admin by the cached role: the buttons are not drawn at all.
    const cut = await openFactory();
    await cut.page.evaluate(() => localStorage.setItem("fh_role", "csm"));
    await cut.page.locator(`#apprBody tr[data-appr='${BRAND}']`).click();
    assert.equal(await cut.page.locator(`#apprBody tr[data-appr='${BRAND}'] + tr.det [data-brand-box]`).count(), 0, "only owner or admin gets the buttons");
    assert.match(await cut.page.locator(`#apprBody tr[data-appr='${BRAND}'] + tr.det`).innerText(), /Only a Fundhub owner or admin can approve a brand or send it back/);
    await cut.page.close();
  });
});

test("every listed Creative Factory row was pressed", () => {
  proof.assertAllClaimed();
});
