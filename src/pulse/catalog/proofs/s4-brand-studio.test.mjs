// Proves the partner Brand Studio (public/app/brand-studio.html) in partner
// mode: every box lands in the saved brand, the wordmark and the domain are
// handled, the funnel pages are created, published and unpublished, an earlier
// copy version can be put back, and the brand is sent for approval.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, bodyOf, json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const PARTNER_ID = "pppppppp-1111-4111-8111-111111111111";
const PAGE_ID = "99999999-1111-4111-8111-111111111111";
// A one pixel PNG, built here so no image file is needed.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function brandRead(over = {}) {
  return {
    ok: true,
    brand: {
      partner_id: PARTNER_ID, entity_name: "Meridian Capital Partners LLC", entity_address: null, support_email: null, domain: null,
      voice: "plain", selected_funnels: ["apply"], approval_status: "draft", ink: "#0A0A0A", paper: "#FCFCFC",
      ramp: ["#F2A69B", "#F5CE8F", "#F2E39B", "#A8D8B0", "#A9C6E8", "#C4B3E5"], display_face: "Inter", mono_face: "JetBrains Mono",
      ...over,
    },
  };
}

async function openStudio(open, { role = "owner", brand = brandRead(), pages = [] } = {}) {
  const calls = { put: [], verify: [], pagesPost: [], pagesPatch: [], restore: [], review: [] };
  let pageList = pages;
  const handlers = {
    // the more specific paths first: a handler matches on a fragment of the address
    "/api/partner-brand/verify-domain": async (route) => { calls.verify.push(bodyOf(route)); return json(route, { ok: true, verified: true }); },
    "/api/partner-brand": async (route, { method }) => {
      if (method === "PUT") { calls.put.push(bodyOf(route)); return json(route, { ok: true }); }
      return json(route, brand);
    },
    "/api/partner-pages": async (route, { method }) => {
      if (method === "POST") {
        const body = bodyOf(route);
        calls.pagesPost.push(body);
        pageList = [...pageList, { id: `page-${body.funnel_key}`, funnel_key: body.funnel_key, title: `${body.funnel_key} page`, slug: body.funnel_key, status: "draft" }];
        return json(route, { ok: true });
      }
      if (method === "PATCH") {
        const body = bodyOf(route);
        calls.pagesPatch.push(body);
        pageList = pageList.map((p) => (p.id === body.id ? { ...p, status: body.status } : p));
        return json(route, { ok: true, page: pageList.find((p) => p.id === body.id) });
      }
      return json(route, { ok: true, items: pageList });
    },
    "/api/partner-marketing/usage": { ok: true, enabled: true, remaining: 5000, cap: 10000, used: 0 },
    "/api/partner-marketing/copy-history": async (route, { method }) => {
      if (method === "POST") { calls.restore.push(bodyOf(route)); return json(route, { ok: true }); }
      return json(route, { ok: true, items: [{ id: "ver-1", section_id: "hero", created_at: "2026-10-01T10:00:00Z" }] });
    },
    "/api/brand/review": async (route) => { calls.review.push(bodyOf(route)); return json(route, { ok: true, approval_status: "review" }); },
  };
  const session = { ok: true, staff: { ...OWNER.staff, role } };
  const opened = await open(`/app/brand-studio.html?partner_id=${PARTNER_ID}`, { session, handlers });
  await opened.page.waitForFunction(() => /Loaded your saved brand\./.test(document.querySelector("#saveMsg")?.innerText || ""));
  return { ...opened, calls };
}

test("every box and card is carried into the saved brand, and a blank legal entity stops the save", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, calls } = await openStudio(open);

  await proof.check(/^Legal entity input/, async () => {
    assert.equal(await page.locator("#bEntity").inputValue(), "Meridian Capital Partners LLC", "the saved entity is on screen");
    await page.locator("#bEntity").fill("");
    await page.locator("#saveBtn").click();
    assert.match(await page.locator("#saveMsg").innerText(), /Legal entity is required/);
    assert.deepEqual(calls.put, [], "no entity, nothing saved");
    await page.locator("#bEntity").fill("Meridian Capital Partners LLC");
    assert.match(await page.locator("#pvLegal").innerText(), /Meridian Capital Partners LLC/, "the entity goes into the preview disclosure");
  });
  await proof.check(/^Business address input/, async () => { await page.locator("#bAddr").fill("1200 Main St Suite 400, Phoenix, AZ 85004"); });
  await proof.check(/^Support email input/, async () => { await page.locator("#bEmail").fill("support@meridiancapital.example"); });
  await proof.check(/^Copy voice select/, async () => { await page.locator("#bVoice").selectOption("warm"); });
  await proof.check(/^Domain input/, async () => {
    await page.locator("#bDomain").fill("https://meridiancapital.example/apply");
    assert.match(await page.locator("#dnsTxt").innerText(), /^awaiting dns$/i, "a typed domain is waiting for DNS");
  });
  await proof.check(/^Funnel cards \(5\)/, async () => {
    await page.locator('[data-f="diag"]').click();
    await page.locator('[data-f="apply"]').click();
    assert.equal(await page.locator("#kFun").innerText(), "1");
    await page.locator('[data-f="apply"]').click();
    assert.equal(await page.locator("#kFun").innerText(), "2");
  });
  await proof.check(/^Wordmark file input/, async () => {
    await page.locator("#bLogo").setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(401 * 1024) });
    await page.waitForFunction(() => /Logo must be under 400KB\./.test(document.querySelector("#saveMsg")?.innerText || ""));
    await page.locator("#bLogo").setInputFiles({ name: "mark.png", mimeType: "image/png", buffer: PNG });
    await page.waitForFunction(() => /Wordmark loaded/.test(document.querySelector("#saveMsg")?.innerText || ""));
  });

  await proof.check(/^Save & apply button/, async () => {
    await page.locator("#saveBtn").click();
    await waitFor(() => calls.put.length === 1);
    const sent = calls.put[0];
    assert.match(sent.wordmark_url, /^data:image\/png;base64,/);
    assert.deepEqual({ ...sent, wordmark_url: "(data url)" }, {
      partner_id: PARTNER_ID, ink: "#0A0A0A", paper: "#FCFCFC",
      ramp: ["#F2A69B", "#F5CE8F", "#F2E39B", "#A8D8B0", "#A9C6E8", "#C4B3E5"], display_face: "Inter", mono_face: "JetBrains Mono",
      voice: "warm", entity_name: "Meridian Capital Partners LLC", entity_address: "1200 Main St Suite 400, Phoenix, AZ 85004",
      support_email: "support@meridiancapital.example", domain: "meridiancapital.example", selected_funnels: ["diag", "apply"],
      wordmark_url: "(data url)",
    });
    await page.waitForFunction(() => /Saved\. Tokens apply to this partner's funnels\./.test(document.querySelector("#saveMsg")?.innerText || ""));
  });
  await page.close();
});

test("Verify is offered to an owner or admin and posts the partner; others do not get it", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Verify button \(DNS TXT check/, async () => {
    const owner = await openStudio(open, { brand: brandRead({ domain: "meridiancapital.example" }) });
    await owner.page.locator("#verifyBtn").click();
    await waitFor(() => owner.calls.verify.length === 1);
    assert.deepEqual(owner.calls.verify[0], { partner_id: PARTNER_ID });
    await owner.page.waitForFunction(() => /DNS verified for meridiancapital\.example/.test(document.querySelector("#saveMsg")?.innerText || ""));
    assert.match(await owner.page.locator("#kDomain").innerText(), /^dns verified$/i);
    await owner.page.close();
    const partner = await openStudio(open, { role: "partner", brand: brandRead({ domain: "meridiancapital.example" }) });
    assert.equal(await partner.page.locator("#verifyBtn").count(), 0, "a partner is not shown a button that can only refuse");
    await partner.page.close();
  });
});

test("pages are created for the ticked funnels, published and unpublished, and a copy version is put back", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, calls } = await openStudio(open, { brand: brandRead({ selected_funnels: ["apply", "diag"] }) });

  await proof.check(/^Create pages from selected funnels button/, async () => {
    await page.locator("#createPagesBtn").click();
    await waitFor(() => calls.pagesPost.length === 2);
    assert.deepEqual(calls.pagesPost, [{ partner_id: PARTNER_ID, funnel_key: "apply" }, { partner_id: PARTNER_ID, funnel_key: "diag" }]);
    await page.waitForFunction(() => document.querySelectorAll("#pagesList [data-pub]").length === 2);
  });
  await proof.check(/^Page row: Publish button/, async () => {
    await page.locator('#pagesList [data-pub="page-apply"]').click();
    await waitFor(() => calls.pagesPatch.length === 1);
    assert.deepEqual(calls.pagesPatch[0], { id: "page-apply", status: "published" });
    await page.waitForFunction(() => /Published\. Live at \/sites\/pppppppp-1111-4111-8111-111111111111\/apply/.test(document.querySelector("#pagesMsg")?.innerText || "") || !!document.querySelector('#pagesList [data-unpub="page-apply"]'));
  });
  await proof.check(/^Page row: Unpublish button/, async () => {
    await page.locator('#pagesList [data-unpub="page-apply"]').click();
    await waitFor(() => calls.pagesPatch.length === 2);
    assert.deepEqual(calls.pagesPatch[1], { id: "page-apply", status: "draft" });
  });
  await proof.check(/^Copy history: Use this version/, async () => {
    await page.waitForSelector("#histList [data-restore]");
    await page.locator("#histList [data-restore]").click();
    await waitFor(() => calls.restore.length === 1);
    assert.equal(calls.restore[0].version_id, "ver-1");
    assert.equal(calls.restore[0].page_id, await page.locator("#histPage").inputValue());
    await page.waitForFunction(() => /Restored that version\./.test(document.querySelector("#genMsg")?.innerText || ""));
  });
  await page.close();
});

test("Submit for approval needs a legal entity, then posts the partner and says it is in review", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Submit for approval button/, async () => {
    const blank = await openStudio(open, { brand: brandRead({ entity_name: null }) });
    await blank.page.locator("#submitBtn").click();
    await blank.page.waitForFunction(() => /Add the legal entity first/.test(document.querySelector("#saveMsg")?.innerText || ""));
    assert.deepEqual(blank.calls.review, []);
    await blank.page.close();

    const ready = await openStudio(open);
    await ready.page.locator("#submitBtn").click();
    await waitFor(() => ready.calls.review.length === 1);
    assert.deepEqual(ready.calls.review[0], { partner_id: PARTNER_ID, action: "submit" });
    await ready.page.waitForFunction(() => /Sent for review\./.test(document.querySelector("#saveMsg")?.innerText || ""));
    assert.match(await ready.page.locator("#approvalTxt").innerText(), /^in review$/i);
    await ready.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
