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

const proof = proofRows(import.meta.url);
const { open } = sharedScreens();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

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
  job(5), job(6), job(7, { asset_kind: "video", formats: ["9x16"], asset_count: 1 }), job(8), job(9),
  job(10, { status: "failed", attempt: 3, error: "no active provider configured", provider: null, asset_count: 0 }),
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
const SCRIPTS = () => [
  { id: S1, title: "Denial angle", version: 2, body_preview: "Banks said no. Here is why." },
  { id: S2, title: null, version: 1, body_preview: "Your credit file is not your fault. It is a record." }
];
const page200 = (items) => ({ ok: true, count: items.length, limit: 200, offset: 0, hasMore: false, items });

/**
 * Open the screen with a stand-in server. `st` holds what each read answers (a test swaps them), and
 * `log` holds every request in order. `answers` decides what a write returns.
 */
async function openFactory({ session = OWNER, query = "", viewport, st: over = {}, answers = {} } = {}) {
  const st = {
    partners: PARTNERS,
    usage: { [P1]: { ok: true, enabled: true, cap: 250000, used: 1200, remaining: 248800 }, [P2]: { ok: true, enabled: false, cap: 250000, used: 0, remaining: 250000 } },
    jobs: JOBS(), library: LIBRARY(), kits: KITS(), approvals: APPROVALS(), scripts: SCRIPTS(), usageStatus: {}, ...over
  };
  const log = { reads: [], generate: [], run: [], actions: [], scriptWrite: [], brand: [], usage: [] };
  const pidOf = (url) => new URL(url).searchParams.get("partner_id");
  const handlers = {
    "/api/read/partners": async (route) => json(route, page200(st.partners)),
    "/api/partner-marketing/usage": async (route, { url }) => {
      const pid = pidOf(url);
      log.usage.push(pid);
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
      const state = body.action === "approve" ? "approved" : body.action === "reject" ? "blocked" : "passed";
      const out = answers.actions ? answers.actions(body) : { status: 200, body: { ok: true, action: body.action, asset: { id: body.asset_id, compliance_state: state, archived_at: body.action === "archive" ? iso(0) : null } } };
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
      session: { ok: true, staff: { id: "p1", name: "Pat", email: "pat@partner.test", role: "partner", org_id: "org-1", status: "active", partner_id: P1 } },
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
      session: { ok: true, staff: { id: "s3", name: "Riley", email: "riley@fundhub.ai", role: "closer", org_id: "org-1", status: "active" } },
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

test("the allowance panel, the Brand Studio link and Enqueue", { timeout: 90_000 }, async () => {
  const on = await openFactory();
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
    // Followed, it opens the Brand Studio screen.
    await off.page.locator("#cfUseBody a[href='brand-studio.html']").click();
    await waitFor(() => off.page.url().includes("brand-studio.html"), "Brand Studio opens");
    await off.page.close();
    // When the suite is on there is no note and no link.
    assert.equal(await count(on.page, "#cfUseBody a[href='brand-studio.html']"), 0);
  });

  await proof.check(/^Enqueue generation button/, async () => {
    // Off: the button stays disabled and says why.
    const off = await openFactory({ query: `?partner_id=${P2}` });
    await waitFor(async () => /has not turned this on for this partner/.test(await text(off.page, "#genMsg")), "the reason line");
    assert.equal(await off.page.locator("#genBtn").isDisabled(), true);
    assert.equal(await off.page.locator("#runJobsBtn").isDisabled(), true);
    assert.equal(await off.page.locator("[data-cact]").first().isDisabled(), true);
    await off.page.close();

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
    assert.equal(video.asset_kind, "video");
    assert.equal(video.spec.offerType, "credit_repair");
    assert.equal(video.spec.prompt, "video for credit_repair");
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
  });
});

test("Decide on one creative: the picker, then Approve, Reject and Archive each ask first", { timeout: 90_000 }, async () => {
  const { page, log } = await openFactory();
  const ask = dialogs(page);
  await waitFor(async () => (await page.locator("#actAsset option").count()) === 10, "ten picker options");

  await proof.check(/^Decide on one creative: creative picker/, async () => {
    const options = await page.locator("#actAsset option").allInnerTexts();
    assert.equal(options[0], "Choose a creative…");
    assert.equal(options.length, 10, "every creative, archived ones too");
    assert.ok(options.some((o) => /archived/.test(o)), "an archived creative says so");
    assert.match(options[1], /^static · 1x1 · pending · cc000000/);
    assert.ok(options.some((o) => /^copy · 4x5 · blocked/.test(o)));
    // The picker holds the library as read; with the library unreadable it offers none.
    const empty = await openFactory({ st: { library: [] } });
    assert.equal(await text(empty.page, "#actAsset"), "No creatives loaded for this partner");
    await empty.page.close();
  });

  await proof.check(/^Approve button \(asks to confirm/, async () => {
    // Nothing chosen: said, nothing sent.
    await page.locator("[data-cact='approve']").click();
    assert.equal(await text(page, "#actMsg"), "Choose a creative first.");
    await page.locator("#actAsset").selectOption(A(1));
    // Dismiss the question: nothing is sent.
    ask.next(false);
    await page.locator("[data-cact='approve']").click();
    await waitFor(() => ask.seen.length === 1, "the confirm question");
    assert.match(ask.seen[0].message, /Approve this creative\? It will be marked approved for this partner\./);
    assert.match(ask.seen[0].message, /static · 1x1 · pending/);
    assert.deepEqual(log.actions, []);
    // Accept it: the exact write, then the screen says what the creative is now.
    ask.next(true);
    await page.locator("[data-cact='approve']").click();
    await waitFor(() => log.actions.length === 1, "the approve request");
    assert.deepEqual(log.actions[0], { partner_id: P1, asset_id: A(1), action: "approve" });
    await waitFor(async () => /Done\. This creative is now approved\./.test(await text(page, "#actMsg")), "the done line");
    const reads = readsFor(log, "library").length;
    await waitFor(() => reads >= 2, "the library read again");
    // The server says no (archived): said in words.
    const refused = await openFactory({ answers: { actions: () => ({ status: 400, body: { ok: false, error: "archived assets cannot be approved" } }) } });
    const ask2 = dialogs(refused.page);
    await refused.page.locator("#actAsset").selectOption(A(5));
    ask2.next(true);
    await refused.page.locator("[data-cact='approve']").click();
    await waitFor(async () => /^Could not approve it\./.test(await text(refused.page, "#actMsg")), "the refusal line");
    await refused.page.close();
  });

  await proof.check(/^Reject button \(asks to confirm/, async () => {
    await page.locator("#actAsset").selectOption(A(4));
    ask.next(true);
    await page.locator("[data-cact='reject']").click();
    await waitFor(() => log.actions.length === 2, "the reject request");
    assert.deepEqual(log.actions[1], { partner_id: P1, asset_id: A(4), action: "reject" });
    assert.match(ask.seen.at(-1).message, /Reject this creative\? It will be marked blocked and cannot be used\./);
    await waitFor(async () => /Done\. This creative is now blocked\./.test(await text(page, "#actMsg")), "the done line");
  });

  await proof.check(/^Archive button \(asks to confirm/, async () => {
    await page.locator("#actAsset").selectOption(A(9));
    ask.next(true);
    await page.locator("[data-cact='archive']").click();
    await waitFor(() => log.actions.length === 3, "the archive request");
    assert.deepEqual(log.actions[2], { partner_id: P1, asset_id: A(9), action: "archive" });
    assert.match(ask.seen.at(-1).message, /Archive this creative\? It will be hidden from the library unless archived items are shown\./);
    await waitFor(async () => /Done\. This creative is now passed and archived\./.test(await text(page, "#actMsg")), "the done line");
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
  });

  await proof.check(/^Generation jobs: row click expands job detail/, async () => {
    await page.locator("#jobLimit").selectOption("25");
    await page.locator(`#jobBody tr[data-job='${J(10)}']`).click();
    const detail = page.locator(`#jobBody tr[data-job='${J(10)}'] + tr.det`);
    assert.equal(await detail.count(), 1);
    assert.match(await detail.innerText(), /what went wrong/i);
    assert.match(await detail.innerText(), /No vendor is switched on\. Trying again will not help\./);
    assert.equal(await page.locator(`#jobBody tr[data-job='${J(10)}']`).getAttribute("aria-expanded"), "true");
    // The detail never prints the engineer's sentence or a table name.
    assert.doesNotMatch(await detail.innerText(), /creative_providers|no active provider configured/);
    // A second press closes it; Enter opens it again from the keyboard.
    await page.locator(`#jobBody tr[data-job='${J(10)}']`).click();
    assert.equal(await page.locator(`#jobBody tr[data-job='${J(10)}'] + tr.det`).count(), 0);
    await page.locator(`#jobBody tr[data-job='${J(11)}']`).focus();
    await page.keyboard.press("Enter");
    assert.match(await page.locator(`#jobBody tr[data-job='${J(11)}'] + tr.det`).innerText(), /The vendor returned nothing\./);
    // A succeeded job says how many creatives it stored.
    await page.locator(`#jobBody tr[data-job='${J(7)}']`).click();
    assert.match(await page.locator(`#jobBody tr[data-job='${J(7)}'] + tr.det`).innerText(), /Succeeded\. 1 asset stored\./);
  });
  await page.close();
});

test("Creative library: filters, pager, the detail drawer and its three ways out", { timeout: 90_000 }, async () => {
  const { page } = await openFactory();
  const cards = () => count(page, "#libGrid .acard");
  await page.locator("#libLimit").selectOption("50");

  await proof.check(/^Creative library: state chips, kind chips/, async () => {
    assert.equal(await cards(), 8, "archived creatives are hidden by default");
    assert.deepEqual(await chipTexts(page, "#libStateRail"), ["all8", "pending2", "passed3", "blocked2", "approved1"]);
    assert.deepEqual(await chipTexts(page, "#libKindRail"), ["any8", "static4", "video2", "copy2"]);
    await page.locator("#libStateRail [data-ls='blocked']").click();
    assert.equal(await cards(), 2);
    await page.locator("#libKindRail [data-lk='copy']").click();
    assert.equal(await cards(), 1, "state and kind narrow together");
    await page.locator("#libStateRail [data-ls='all']").click();
    assert.equal(await cards(), 2);
    await page.locator("#libFormatRail [data-lf='4x5']").click();
    assert.equal(await cards(), 1);
    await page.locator("#libKindRail [data-lk='']").click();
    assert.equal(await cards(), 2, "static and copy at 4x5");
    await page.locator("#libFormatRail [data-lf='']").click();
    // Brand kit select.
    await page.locator("#libKit").selectOption(K2);
    assert.equal(await cards(), 3);
    await page.locator("#libKit").selectOption("");
    await page.locator("#libKindRail [data-lk='']").click();
    // Include archived adds the archived one and labels it.
    assert.equal(await cards(), 8);
    await page.locator("#libArch").selectOption("1");
    assert.equal(await cards(), 9);
    await page.locator("#libArch").selectOption("");
    assert.equal(await cards(), 8);
    // The size select and an empty filter message.
    await page.locator("#libLimit").selectOption("6");
    assert.equal(await cards(), 6);
    await page.locator("#libStateRail [data-ls='approved']").click();
    await page.locator("#libKindRail [data-lk='copy']").click();
    assert.equal(await cards(), 0);
    assert.match(await text(page, "#libGrid"), /No assets match this filter for this partner\./);
    await page.locator("#libStateRail [data-ls='all']").click();
    await page.locator("#libKindRail [data-lk='']").click();
  });

  await proof.check(/^Creative library: asset card click opens the detail drawer; prev \/ next pager/, async () => {
    await page.locator("#libLimit").selectOption("6");
    assert.equal(await cards(), 6);
    assert.equal(await page.locator("#libPager [data-mv='-1']").isDisabled(), true);
    await page.locator("#libPager [data-mv='1']").click();
    assert.equal(await cards(), 2);
    assert.equal(await page.locator("#libPager [data-mv='1']").isDisabled(), true);
    await page.locator("#libPager [data-mv='-1']").click();
    assert.equal(await cards(), 6);
    // Clicking a card opens its drawer with the words, the flags and why it was stopped.
    await page.locator(`#libGrid .acard[data-asset='${A(2)}']`).click();
    assert.equal(await drawerOpen(page), true);
    assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"), "false");
    const body = await text(page, "#dwBody");
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

test("Review queue and Brand kits: chips, size select, pager, row detail", { timeout: 90_000 }, async () => {
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
    // The size select and the pager.
    await page.locator("#apprLimit").selectOption("5");
    await page.locator("#apprRail [data-as='all']").click();
    assert.equal(await page.locator("#apprPager [data-mv='-1']").isDisabled(), true);
    assert.equal(await page.locator("#apprPager [data-mv='1']").isDisabled(), true, "four rows fit one page of five");
  });

  await proof.check(/^Review queue: 'Open the full creative' button on a row/, async () => {
    await page.locator(`#apprBody tr[data-appr='${A(1)}']`).click();
    const open = page.locator(`#apprBody tr[data-appr='${A(1)}'] + tr.det [data-open-asset]`);
    assert.equal(await open.count(), 1);
    assert.equal(await drawerOpen(page), false);
    await open.click();
    assert.equal(await drawerOpen(page), true);
    assert.match(await text(page, "#dwTitle"), /^static · 1x1 · cc000000/);
    assert.match(await text(page, "#dwBody"), /review state[\s\S]*pending/i);
    // The row stays open under the drawer; the campaign and brand rows have no such button.
    await page.keyboard.press("Escape");
    await page.locator(`#apprBody tr[data-appr='${CAMPAIGN}']`).click();
    assert.equal(await page.locator(`#apprBody tr[data-appr='${CAMPAIGN}'] + tr.det [data-open-asset]`).count(), 0);
  });

  await proof.check(/^Brand kits: state chips, kit card click opens drawer, prev \/ next/, async () => {
    assert.deepEqual(await chipTexts(page, "#kitRail"), ["all7", "draft2", "active3", "archived2"]);
    assert.equal(await count(page, "#kitGrid .kit"), 6, "six kits to a page");
    assert.equal(await page.locator("#kitPager [data-mv='-1']").isDisabled(), true);
    await page.locator("#kitPager [data-mv='1']").click();
    assert.equal(await count(page, "#kitGrid .kit"), 1);
    await page.locator("#kitPager [data-mv='-1']").click();
    await page.locator("#kitRail [data-ks='archived']").click();
    assert.equal(await count(page, "#kitGrid .kit"), 2);
    await page.locator("#kitRail [data-ks='all']").click();
    await page.locator(`#kitGrid .kit[data-kit='${K1}']`).click();
    assert.equal(await drawerOpen(page), true);
    const body = await text(page, "#dwBody");
    assert.match(body, /name[\s\S]*kit 1/i);
    assert.match(body, /plain and direct/i);
    assert.match(body, /working capital/i);
    assert.match(await text(page, "#dwEyebrow"), /brand kit/i);
    await page.keyboard.press("Escape");
    assert.equal(log.reads.filter(([n]) => n === "kits").length, 1, "the chips filter in the page and read nothing new");
  });
  await proof.check(/^Reference section/, async () => {
    const summaries = await page.locator(".scopebar summary").allInnerTexts();
    assert.deepEqual(summaries, ["What each job state means", "How the AI labels are decided", "Why creative gets stopped", "Settings the creative engine ships with"]);
    assert.deepEqual(await page.locator(".scopebar").evaluateAll((els) => els.map((e) => e.open)), [false, false, false, false], "all four start closed");
    // Each one opens and shows its own table or counts.
    await page.locator(".scopebar summary", { hasText: "What each job state means" }).click();
    assert.match(await text(page, "#stateLegend"), /Queued[\s\S]*Retrying[\s\S]*Running[\s\S]*Succeeded[\s\S]*Failed/);
    await page.locator(".scopebar summary", { hasText: "How the AI labels are decided" }).click();
    assert.equal(await count(page, "#flagBody tr"), 5);
    await page.locator(".scopebar summary", { hasText: "Why creative gets stopped" }).click();
    assert.equal(await count(page, "#ruleBody tr"), 29, "29 reasons listed");
    assert.equal(await count(page, "#ruleBody tr.stripe-info"), 2, "two of them hold the work for a person");
    await page.locator(".scopebar summary", { hasText: "Settings the creative engine ships with" }).click();
    assert.equal(await count(page, "#gapsBody tr"), 7);
    assert.deepEqual(await page.locator(".scopebar").evaluateAll((els) => els.map((e) => e.open)), [true, true, true, true]);
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
