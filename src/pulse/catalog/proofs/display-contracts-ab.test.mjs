import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import {
  DISPLAY_CONTRACT_KEYS_AB,
  DISPLAY_CONTRACT_PROOF_AB,
  DISPLAY_CONTRACTS_AB,
} from "./display-contracts-ab.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"));
const DAY = 86_400_000;
const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";

const TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) =>
    candidate.startsWith(`${PUBLIC}${path.sep}`) && fs.existsSync(candidate));
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const file = staticFile(new URL(req.url, "http://127.0.0.1").pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES.get(path.extname(file)) || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  return true;
}

function session(role = "owner") {
  return {
    ok: true,
    staff: {
      id: "staff-proof",
      affiliate_id: "aff-proof",
      name: "Ava Affiliate",
      email: "ava@example.test",
      role,
      org_id: "org-proof",
      status: "active",
    },
  };
}

async function proofPage(browser, api, role = "owner") {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript((staffRole) => {
    localStorage.setItem("fh_token", "display-ab-proof-token");
    localStorage.setItem("fh_role", staffRole);
    localStorage.removeItem("fh_demo");
    window.__copied = [];
    window.__opened = [];
    window.__downloads = [];
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (value) => { window.__copied.push(String(value)); } },
      });
    } catch (_) {}
    window.open = (url, target, features) => {
      window.__opened.push({ url, target, features });
      return null;
    };
    URL.createObjectURL = () => "blob:display-ab-proof";
    URL.revokeObjectURL = () => {};
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function proofDownloadClick() {
      if (this.download) {
        window.__downloads.push({ href: this.href, download: this.download });
        return;
      }
      return click.call(this);
    };
  }, role);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (await api(route, url)) return;
    if (url.pathname === "/api/auth/session" || url.pathname === "/api/session") {
      return json(route, session(role));
    }
    return json(route, { ok: true, items: [], count: 0, hasMore: false });
  });
  return page;
}

async function prove(t, exercised, rowKey, assertion) {
  assert.ok(DISPLAY_CONTRACT_KEYS_AB.includes(rowKey), `unknown proof row key ${rowKey}`);
  await t.test(rowKey, async () => {
    await assertion();
    assert.equal(exercised.has(rowKey), false, `row key exercised twice: ${rowKey}`);
    exercised.add(rowKey);
  });
}

async function assertVisibleText(page, selector, text) {
  const locator = page.locator(selector);
  assert.equal(await locator.isVisible(), true, `${selector} should be visible`);
  assert.match(await locator.innerText(), new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

async function assertActivePane(page, active) {
  for (const name of ["leads", "payouts", "terms"]) {
    const isActive = name === active;
    assert.equal(await page.locator(`[data-tab="${name}"]`).evaluate((el) => el.classList.contains("on")), isActive);
    assert.equal(await page.locator(`#tab-${name}`).evaluate((el) => el.classList.contains("on")), isActive);
    assert.equal(await page.locator(`#tab-${name}`).isVisible(), isActive);
  }
}

function daysAgo(days) {
  return new Date(Date.now() - days * DAY).toISOString();
}

test("Display AB exports only exact freshly compiled rows and complete proof metadata", () => {
  assert.equal(DISPLAY_CONTRACT_PROOF_AB.strictProvedCount, 30);
  assert.equal(new Set(DISPLAY_CONTRACT_KEYS_AB).size, DISPLAY_CONTRACT_KEYS_AB.length);
  assert.deepEqual(DISPLAY_CONTRACT_PROOF_AB.sourceFiles, ["desks-a.json", "desks-b.json"]);

  const byId = new Map(CATALOG.items.map((row) => [row.id, row]));
  for (const proof of DISPLAY_CONTRACTS_AB) {
    const row = byId.get(proof.rowKey);
    assert.ok(row, `catalog row is missing: ${proof.rowKey}`);
    assert.equal(row.sourceFile, proof.sourceFile);
    assert.equal(row.surface, proof.surface);
    assert.equal(row.family, proof.family);
    assert.equal(row.expected, proof.expected);
    assert.equal(row.proofVerdict, undefined, `${proof.rowKey} stayed red after its executable proof compiled`);
    assert.equal(row.proofDepth, proof.proof.depth);
    assert.equal(row.state, "wired");
    assert.ok(row.proof.tests.length > 0, `${proof.rowKey} lost its executable proof target`);
    assert.equal(proof.proof.runner, "rendered-chromium-local-fake-routes");
    assert.equal(proof.proof.file, "src/pulse/catalog/proofs/display-contracts-ab.test.mjs");
    assert.ok(proof.proof.assertion.length > 20);
  }
});

test("Display AB runs every exported row through the real rendered page", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const exercised = new Set();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const affiliateQuestions = [];
  const affiliateGiftRequests = [];
  const affiliate = await proofPage(browser, async (route, url) => {
    if (url.pathname === "/api/read/affiliates") {
      return json(route, {
        ok: true,
        items: [{
          id: "aff-proof",
          tracking_id: "FH1042",
          license_signed: false,
          balance_due: "1250.50",
          referred_count: 4,
          referred_untracked: 0,
          converted_count: 2,
          unrated_converted_count: 0,
          clicks_count: 10,
          clicks_30d: 7,
          paid_total: "600.00",
          paid_runs: 1,
        }],
      });
    }
    if (url.pathname === "/api/read/affiliate-portal") {
      return json(route, {
        ok: true,
        enrolled: true,
        affiliate: {
          id: "aff-proof",
          name: "Ava Affiliate",
          code: "FH1042",
          offerLinks: [
            { name: "Capital Blueprint", url: "https://fundhub.ai/start?ref=FH1042&offer=blueprint" },
            { name: "Repair", url: "https://fundhub.ai/start?ref=FH1042&offer=repair" },
          ],
        },
        rates: { direct: { percent: 20, rules: [{}] }, downline: { percent: 5 } },
        gates: {
          license: { signed: false, documentRef: "license-2026.pdf" },
          tax: { onFile: false },
        },
        referrals: [
          { attributedAt: "2026-10-01T12:00:00Z", name: "Alpha Studio", status: "attributed", product: "", basisAmount: null, commissionDue: null },
          { attributedAt: "2026-10-02T12:00:00Z", name: "Beta Builders", status: "converted", product: "Funding", basisAmount: 3000, commissionDue: 600 },
          { attributedAt: "2026-10-03T12:00:00Z", name: "Gamma Goods", status: "paid", product: "Repair", basisAmount: 1000, commissionDue: 200 },
          { attributedAt: "2026-10-04T12:00:00Z", name: "Delta Design", status: "void", product: "Funding", basisAmount: 3000, commissionDue: 0 },
        ],
        payouts: [{
          paidAt: "2026-10-11T12:00:00Z",
          periodStart: "2026-10-01T00:00:00Z",
          periodEnd: "2026-10-10T00:00:00Z",
          lineCount: 1,
          method: "ACH",
          amount: 600,
          status: "paid",
        }],
      });
    }
    if (url.pathname === "/api/read/company-brain-affiliate") {
      affiliateQuestions.push(route.request().postDataJSON());
      return json(route, {
        ok: true,
        answer: { text: "Approved partners earn the saved agreement rate." },
        sources: [{ n: 1, fileName: "Partner Kit.pdf", webViewLink: "https://drive.google.com/file/d/proof/view" }],
      });
    }
    if (url.pathname === "/api/gifts/message-blaster") {
      affiliateGiftRequests.push({ method: route.request().method(), authorization: route.request().headers().authorization });
      await route.fulfill({ status: 200, contentType: "application/x-apple-diskimage", body: "proof-dmg" });
      return true;
    }
    return false;
  });
  await affiliate.goto(`${origin}/app/affiliate.html`, { waitUntil: "domcontentloaded" });
  await affiliate.waitForFunction(() => document.querySelector("#kRef")?.textContent === "4"
    && document.querySelectorAll("#leadBody tr").length === 4
    && document.querySelector("#affiliateLoadStatus")?.textContent === "Your referral dashboard is up to date."
    && document.querySelector("#affLicenseChip")?.offsetParent !== null);

  await prove(t, exercised, "c66a9dec0593294d0aa3", async () => {
    assert.equal(await affiliate.locator("#kRef").textContent(), "4");
    assert.equal(await affiliate.locator("#kConv").textContent(), "2");
    assert.equal(await affiliate.locator("#kOwed").textContent(), "$1,250.50");
    assert.equal(await affiliate.locator("#kPaid").textContent(), "$600.00");
    assert.match(await affiliate.locator("#funnelBody").innerText(), /10[\s\S]*Clicks[\s\S]*4[\s\S]*Referred[\s\S]*2[\s\S]*Converted/);
    await assertVisibleText(affiliate, "#licenseBanner", "Payouts are held — your partner license is not signed");
    await assertVisibleText(affiliate, "#affLicenseChip", "License unsigned");
    await assertVisibleText(affiliate, "#affWhoChip", "Ava Affiliate");
  });
  await prove(t, exercised, "fa2aa4b2f5e4654d4a53", async () => {
    assert.equal(await affiliate.locator("#affCode").textContent(), "FH1042");
    assert.equal(await affiliate.locator("#affRate").textContent(), "20%");
    assert.equal(await affiliate.locator('#offerLinks input[aria-label="Capital Blueprint link"]').inputValue(), "https://fundhub.ai/start?ref=FH1042&offer=blueprint");
    assert.match(await affiliate.locator("#leadBody").innerText(), /Beta Builders[\s\S]*Funding[\s\S]*\$600\.00/);
    assert.match(await affiliate.locator("#payBody").innerText(), /ACH[\s\S]*\$600\.00[\s\S]*Paid/);
    await assertVisibleText(affiliate, "#licenseBanner", "Payouts are held — your partner license is not signed");
    await assertVisibleText(affiliate, "#licenseBannerBody", "license-2026.pdf");
    await assertVisibleText(affiliate, "#affLicenseChip", "License unsigned");
    await assertVisibleText(affiliate, "#taxBanner", "We have no record of your tax form");
    await assertVisibleText(affiliate, "#taxBannerBody", "We need a tax form on file before a payout can be sent.");
  });
  await prove(t, exercised, "1f5d200a940850f07a7a", async () => {
    const buttons = affiliate.locator("#offerLinks button");
    assert.equal(await buttons.count(), 2);
    await buttons.nth(0).click();
    await buttons.nth(1).click();
    await affiliate.waitForFunction(() => window.__copied.length === 2);
    assert.deepEqual(await affiliate.evaluate(() => window.__copied), [
      "https://fundhub.ai/start?ref=FH1042&offer=blueprint",
      "https://fundhub.ai/start?ref=FH1042&offer=repair",
    ]);
  });
  await prove(t, exercised, "ff0c636c4295df6453f8", async () => {
    await affiliate.locator("#copyCode").click();
    await affiliate.waitForFunction(() => window.__copied.length === 3);
    assert.equal((await affiliate.evaluate(() => window.__copied)).at(-1), "FH1042");
  });
  await prove(t, exercised, "a001abe8b2f5e1eeee4d", async () => {
    await affiliate.locator('[data-tab="payouts"]').click();
    await assertActivePane(affiliate, "payouts");
    await affiliate.locator('[data-tab="leads"]').click();
    await assertActivePane(affiliate, "leads");
  });
  await prove(t, exercised, "1fb40e791f5d70030492", async () => {
    await affiliate.locator('[data-tab="payouts"]').click();
    await assertActivePane(affiliate, "payouts");
    assert.match(await affiliate.locator("#payBody").innerText(), /2026-10-11[\s\S]*ACH[\s\S]*\$600\.00/);
  });
  await prove(t, exercised, "a0be8585bdb0113143f0", async () => {
    await assertActivePane(affiliate, "payouts");
    await affiliate.locator('[data-tab="terms"]').click();
    await assertActivePane(affiliate, "terms");
    const terms = await affiliate.locator("#tab-terms").innerText();
    for (const word of ["Rate", "Attribution", "Qualifying products", "Payout schedule", "Clawback"]) assert.match(terms, new RegExp(word, "i"));
  });
  await affiliate.locator('[data-tab="leads"]').click();
  await prove(t, exercised, "d8efa1bf6bef5f66368d", async () => {
    const filter = affiliate.locator("#stFilter");
    for (const status of ["Referred", "Converted", "Paid", "Void"]) {
      await filter.selectOption({ label: status });
      assert.equal(await affiliate.locator("#leadBody tr").count(), 1);
      assert.match(await affiliate.locator("#leadBody").innerText(), new RegExp(status, "i"));
    }
    await filter.selectOption("");
    assert.equal(await affiliate.locator("#leadBody tr").count(), 4);
  });
  await prove(t, exercised, "73e3fea9589839f3a44c", async () => {
    await affiliate.locator("#q").fill("beta builders");
    assert.equal(await affiliate.locator("#leadBody tr").count(), 1);
    assert.match(await affiliate.locator("#leadBody").innerText(), /Beta Builders/);
    assert.doesNotMatch(await affiliate.locator("#leadBody").innerText(), /Alpha Studio/);
    await affiliate.locator("#q").fill("");
  });
  await prove(t, exercised, "0833ac214214e536b45a", async () => {
    await affiliate.locator("#brainQ").fill("What is my saved rate?");
    await affiliate.locator("#brainBtn").click();
    await affiliate.waitForFunction(() => document.querySelector("#brainStatus")?.textContent === "Answer ready (allowlist only)");
    assert.deepEqual(affiliateQuestions, [{ question: "What is my saved rate?" }]);
    assert.equal(await affiliate.locator("#brainAnswer").textContent(), "Approved partners earn the saved agreement rate.");
  });
  await prove(t, exercised, "07613e1b9e5c4b51a874", async () => {
    const open = affiliate.locator('#brainSources a:has-text("Open")');
    assert.equal(await open.getAttribute("href"), "https://drive.google.com/file/d/proof/view");
    assert.equal(await open.getAttribute("target"), "_blank");
    assert.equal(await open.getAttribute("rel"), "noopener");
  });
  await prove(t, exercised, "b979ec9e4dd2a0375a5c", async () => {
    await affiliate.locator("#blasterBtn").click();
    await affiliate.waitForFunction(() => document.querySelector("#blasterStatus")?.textContent?.startsWith("Download started"));
    assert.deepEqual(affiliateGiftRequests, [{ method: "GET", authorization: "Bearer display-ab-proof-token" }]);
    assert.deepEqual(await affiliate.evaluate(() => window.__downloads), [{ href: "blob:display-ab-proof", download: "MessageBlaster.dmg" }]);
  });
  await prove(t, exercised, "278c31c93f484cbbb117", async () => {
    const details = affiliate.locator("details.scopebar");
    assert.equal(await details.getAttribute("open"), null);
    await details.locator("summary").click();
    assert.equal(await details.getAttribute("open"), "");
    assert.match(await details.innerText(), /only see people who used your link[\s\S]*do not see their contact details or credit file/i);
  });
  await prove(t, exercised, "367dca0db64096fe33fd", async () => {
    assert.equal(await affiliate.locator("#licenseBanner").isVisible(), true);
    assert.match(await affiliate.locator("#licenseBanner").innerText(), /Payouts are held[\s\S]*license-2026\.pdf/);
    assert.equal(await affiliate.locator("#affLicenseChip").isVisible(), true);
    assert.match(await affiliate.locator("#affLicenseChip").innerText(), /License unsigned/i);
  });
  await prove(t, exercised, "7c20a9c65b6f848d0093", async () => {
    assert.equal(await affiliate.locator("#taxBanner").isVisible(), true);
    assert.match(await affiliate.locator("#taxBanner").innerText(), /no record of your tax form[\s\S]*before a payout can be sent/i);
  });
  await affiliate.close();

  const workflows = [
    {
      id: "sales-follow-up", name: "Sales follow-up", category: "Sales", events: ["lead.created"], crons: [],
      status: "trigger_seen", last_triggered_at: "2026-10-12T12:00:00Z", schedule_plain: null,
      can_start_today: true, blocked_reason: null,
      emitters: [{ event: "lead.created", how: "The apply form saves a lead", gate: "LEADS_ON", gate_set: true, note: "Verified form path." }],
      run_records_available: false, run_records_note: "This page shows what starts a job, not whether it finished.", emitters_verified_on: "2026-10-12",
    },
    {
      id: "money-pulse", name: "Money pulse", category: "Money", events: [], crons: ["0 * * * *"],
      status: "scheduled", last_triggered_at: null, schedule_plain: "every hour",
      can_start_today: null, blocked_reason: null, emitters: [],
      run_records_available: false, run_records_note: "This page shows what starts a job, not whether it finished.", emitters_verified_on: "2026-10-12",
    },
  ];
  const automations = await proofPage(browser, async (route, url) => {
    if (url.pathname === "/api/read/workflows") return json(route, { ok: true, items: workflows, hasMore: false });
    return false;
  });
  await automations.goto(`${origin}/app/automations.html`, { waitUntil: "domcontentloaded" });
  await automations.waitForFunction(() => document.querySelectorAll(".rail-group").length === 2);
  await prove(t, exercised, "a5cf5cb247838154e290", async () => {
    assert.deepEqual(await automations.locator("#rail-select option").allTextContents(), ["All rails", "Money", "Sales"]);
    await automations.locator("#rail-select").selectOption("Sales");
    assert.equal(await automations.locator('.rail-group[data-rail="Sales"]').isVisible(), true);
    assert.equal(await automations.locator('.rail-group[data-rail="Money"]').isVisible(), false);
    await automations.locator("#rail-select").selectOption("All rails");
    assert.equal(await automations.locator(".rail-group:visible").count(), 2);
  });
  await prove(t, exercised, "67e44427dd688334e117", async () => {
    const row = automations.locator('tr[data-wf]').filter({ hasText: "Sales follow-up" });
    const panel = row.locator("xpath=following-sibling::tr[1]");
    await row.click();
    assert.equal(await row.getAttribute("aria-expanded"), "true");
    assert.equal(await panel.isVisible(), true);
    const text = await panel.innerText();
    assert.match(text, /What would start this job[\s\S]*The apply form saves a lead/i);
    assert.match(text, /Raw registry[\s\S]*sales-follow-up[\s\S]*lead\.created/i);
    await row.press("Enter");
    assert.equal(await row.getAttribute("aria-expanded"), "false");
    assert.equal(await panel.isVisible(), false);
  });
  await automations.close();

  const documentRows = [
    { id: "d-auth", kind: "authorization", subtype: "soft_pull", title: "Soft Pull Authorization", client_name: "Auth Client", created_at: daysAgo(20), generated_at: null, delivered_at: null, delivery_status: "not_delivered", signature_required: true, signed_at: null, expires_at: new Date(Date.now() + 30 * DAY).toISOString(), mime_type: null, current_version: 1 },
    { id: "d-draft", kind: "contract", subtype: "funding", title: "Funding Draft", client_name: "Draft Client", created_at: daysAgo(3), generated_at: daysAgo(3), delivered_at: null, delivery_status: "not_delivered", signature_required: true, signed_at: null, expires_at: new Date(Date.now() + 30 * DAY).toISOString(), mime_type: "application/pdf", current_version: 1 },
    { id: "d-sent", kind: "contract", subtype: "funding", title: "Funding Sent", client_name: "Sent Client", created_at: daysAgo(4), generated_at: daysAgo(3), delivered_at: daysAgo(2), delivery_status: "sent", signature_required: true, signed_at: null, expires_at: new Date(Date.now() + 30 * DAY).toISOString(), mime_type: "application/pdf", current_version: 2 },
    { id: "d-viewed", kind: "contract", subtype: "repair", title: "Repair Opened", client_name: "Opened Client", created_at: daysAgo(5), generated_at: daysAgo(4), delivered_at: daysAgo(2), delivery_status: "delivered", signature_required: true, signed_at: null, expires_at: new Date(Date.now() + 30 * DAY).toISOString(), mime_type: "application/pdf", current_version: 1 },
    { id: "d-signed", kind: "contract", subtype: "funding", title: "Funding Signed", client_name: "Signed Client", created_at: daysAgo(6), generated_at: daysAgo(5), delivered_at: daysAgo(4), delivery_status: "delivered", signature_required: true, signed_at: daysAgo(1), expires_at: new Date(Date.now() + 30 * DAY).toISOString(), mime_type: "application/pdf", current_version: 3 },
    { id: "d-void", kind: "contract", subtype: "repair", title: "Repair Void", client_name: "Void Client", created_at: daysAgo(6), generated_at: daysAgo(5), delivered_at: daysAgo(4), delivery_status: "delivered", signature_required: false, signed_at: null, expires_at: null, mime_type: "application/pdf", current_version: 1 },
    { id: "d-invoice", kind: "invoice_document", subtype: "invoice", title: "Invoice One", client_name: "Invoice Client", created_at: daysAgo(30), generated_at: daysAgo(30), delivered_at: null, delivery_status: "not_delivered", signature_required: false, signed_at: null, expires_at: null, mime_type: "application/pdf", current_version: 1 },
    { id: "d-deliverable", kind: "deliverable", subtype: "underwriteiq", title: "UnderwriteIQ Pack", client_name: "Report Client", created_at: daysAgo(2), generated_at: daysAgo(2), delivered_at: daysAgo(1), delivery_status: "delivered", signature_required: false, signed_at: null, expires_at: null, mime_type: "application/pdf", current_version: 1 },
    { id: "d-upload", kind: "client_upload", subtype: "id_document", title: "Identity Upload", client_name: "Upload Client", created_at: daysAgo(1), generated_at: daysAgo(1), delivered_at: null, delivery_status: "not_delivered", signature_required: false, signed_at: null, expires_at: null, mime_type: "image/jpeg", current_version: 1 },
  ];
  const contracts = [
    { id: "ct-draft", document_id: "d-draft", status: "draft", signed_document_id: null },
    { id: "ct-sent", document_id: "d-sent", status: "sent", signed_document_id: null },
    { id: "ct-viewed", document_id: "d-viewed", status: "viewed", signed_document_id: null },
    { id: "ct-signed", document_id: "d-signed", status: "signed", signed_document_id: "signed-copy-1" },
    { id: "ct-void", document_id: "d-void", status: "void", signed_document_id: null },
  ];
  const documentWrites = [];
  const documentLinkReads = [];
  const contractFileReads = [];

  function documentApi(role) {
    return async (route, url) => {
      if (url.pathname === "/api/auth/session") return json(route, session(role));
      if (url.pathname === "/api/read/documents") return json(route, { ok: true, count: documentRows.length, limit: 200, offset: 0, hasMore: false, items: documentRows });
      if (url.pathname === "/api/read/contracts" && url.searchParams.get("file") === "contract") {
        contractFileReads.push(url.toString());
        return json(route, { ok: true, pdf_base64: "JVBERi0xLjQ=", filename: "signed-funding.pdf" });
      }
      if (url.pathname === "/api/read/contracts") return json(route, { ok: true, items: contracts });
      if (url.pathname === "/api/documents-download") {
        documentLinkReads.push(url.toString());
        return json(route, { ok: true, document: { id: url.searchParams.get("id"), download: { url: "https://signed.example.test/d-upload?sig=proof", expires_in: 900 } } });
      }
      if (url.pathname === "/api/contracts" && route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        documentWrites.push(body);
        return json(route, { ok: true, message: body.action === "remind" ? "Reminder queued for Sent Client." : "Contract voided for the saved reason." });
      }
      return false;
    };
  }

  const documents = await proofPage(browser, documentApi("owner"), "owner");
  await documents.goto(`${origin}/app/documents.html?client_id=${CLIENT_ID}`, { waitUntil: "domcontentloaded" });
  await documents.waitForFunction(() => document.querySelectorAll("#body tr").length === 9 && document.querySelectorAll("#body td:last-child .badge").length === 5);

  const row = (title) => documents.locator("#body tr").filter({ hasText: title });
  const documentTitlesByClass = Object.freeze({
    auth: ["Soft Pull Authorization"],
    contract: ["Funding Draft", "Funding Sent", "Repair Opened", "Funding Signed", "Repair Void"],
    invoice: ["Invoice One"],
    deliverable: ["UnderwriteIQ Pack"],
    upload: ["Identity Upload"],
  });
  const allDocumentTitles = Object.values(documentTitlesByClass).flat().sort();
  const pendingDocumentBadges = Object.freeze({
    "Soft Pull Authorization": ["Queued", "Not sent", "Awaiting", "20d"],
    "Funding Draft": ["Generated", "Not sent", "Awaiting", "3d"],
    "Funding Sent": ["Generated", "Sent", "Awaiting", "2d"],
    "Repair Opened": ["Generated", "Sent", "Awaiting", "2d"],
    "Invoice One": ["Generated", "Not sent", "N/A", "30d"],
  });
  const visibleDocumentTitles = (page) => page.locator("#body tr td:first-child > div:first-child").allTextContents();
  const documentState = async (rowLocator) => Promise.all([
    rowLocator.locator("td").nth(3).locator(".badge").innerText(),
    rowLocator.locator("td").nth(4).locator(".badge").innerText(),
    rowLocator.locator("td").nth(5).locator(".badge").innerText(),
    rowLocator.locator("td").nth(6).locator(".age").innerText(),
  ]);
  const resetDocuments = async () => {
    const pending = documents.locator("#pendingBtn");
    if ((await pending.textContent()) === "Showing pending") await pending.click();
    await documents.locator("#q").fill("");
    await documents.locator("#statusFilter").selectOption("");
    const all = documents.locator('#tabs [data-c=""]');
    if (!(await all.isDisabled())) await all.click();
    await documents.waitForFunction(() => document.querySelectorAll("#body tr").length === 9);
  };

  await prove(t, exercised, "a306439da61f8d874841", async () => {
    assert.equal(await documents.locator("#kTotal").textContent(), "9");
    assert.equal(await documents.locator("#kSign").textContent(), "4");
    assert.equal(await documents.locator("#kUndel").textContent(), "2");
    assert.equal(await documents.locator("#staleTxt").textContent(), "2 overdue · 14+ days");
  });
  await prove(t, exercised, "c31881ec935f59eb86e2", async () => {
    const guide = documents.locator(".document-guide");
    await guide.locator("summary").click();
    assert.equal(await guide.getAttribute("open"), "");
    for (const [kind, titles] of Object.entries(documentTitlesByClass)) {
      const card = documents.locator(`.classcard[data-c="${kind}"]`);
      await card.click();
      assert.deepEqual((await visibleDocumentTitles(documents)).sort(), [...titles].sort());
      assert.equal(await documents.locator(`.classcard[data-c="${kind}"]`).evaluate((el) => el.classList.contains("on")), true);
      await documents.locator(`.classcard[data-c="${kind}"]`).click();
      assert.deepEqual((await visibleDocumentTitles(documents)).sort(), allDocumentTitles);
    }
  });
  await prove(t, exercised, "ff6c84f6b25d8ae11f1e", async () => {
    assert.equal(await documents.locator("#tabs .tab").count(), 6);
    for (const [kind, titles] of Object.entries(documentTitlesByClass)) {
      await documents.locator(`#tabs [data-c="${kind}"]`).click();
      assert.deepEqual((await visibleDocumentTitles(documents)).sort(), [...titles].sort());
      assert.equal(await documents.locator(`#tabs [data-c="${kind}"]`).getAttribute("aria-pressed"), "true");
    }
    await documents.locator('#tabs [data-c=""]').click();
    assert.deepEqual((await visibleDocumentTitles(documents)).sort(), allDocumentTitles);
  });
  await prove(t, exercised, "7ff204cc904bd0ed6a36", async () => {
    await documents.locator("#pendingBtn").click();
    assert.equal(await documents.locator("#pendingBtn").textContent(), "Showing pending");
    assert.deepEqual((await visibleDocumentTitles(documents)).sort(), Object.keys(pendingDocumentBadges).sort());
    for (const [title, badges] of Object.entries(pendingDocumentBadges)) {
      assert.deepEqual(await documentState(row(title)), badges, `${title} pending state`);
    }
    await documents.locator("#pendingBtn").click();
    assert.equal(await documents.locator("#pendingBtn").textContent(), "Pending only");
    assert.deepEqual((await visibleDocumentTitles(documents)).sort(), allDocumentTitles);
  });
  await prove(t, exercised, "5814c91b4914edd649e1", async () => {
    await documents.locator("#q").fill("Upload Client");
    assert.equal(await documents.locator("#body tr").count(), 1);
    assert.match(await documents.locator("#body").innerText(), /Identity Upload[\s\S]*Upload Client/);
    await documents.locator("#q").fill("Funding Draft");
    assert.equal(await documents.locator("#body tr").count(), 1);
    assert.match(await documents.locator("#body").innerText(), /Funding Draft[\s\S]*Draft Client/);
    await documents.locator("#q").fill("");
  });
  await prove(t, exercised, "9333c8402151aa97ec49", async () => {
    await resetDocuments();
    const model = await documents.evaluate(() => DOCS.map((d) => ({ doc: d.doc, client: d.client, cls: d.cls, gen: d.gen, del: d.del, sig: d.sig, age: d.age })));
    const compare = (key, dir) => model.slice().sort((a, b) => {
      const av = a[key]; const bv = b[key];
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    }).map((entry) => entry.doc);
    const shown = () => documents.locator("#body tr td:first-child > div:first-child").allTextContents();
    const headers = documents.locator("#tbl th[data-s]");
    assert.equal(await headers.count(), 7);
    for (let index = 0; index < 7; index += 1) {
      const header = headers.nth(index);
      const key = await header.getAttribute("data-s");
      let label = await header.textContent();
      if (!label.endsWith(" ↓")) {
        await header.click();
        label = await header.textContent();
        if (!label.endsWith(" ↓")) await header.click();
      }
      assert.deepEqual(await shown(), compare(key, -1), `${key} descending DOM order`);
      await header.click();
      assert.deepEqual(await shown(), compare(key, 1), `${key} ascending DOM order`);
    }
  });
  await prove(t, exercised, "c439c8e2e1aeeec25347", async () => {
    await resetDocuments();
    assert.deepEqual(await documentState(row("Soft Pull Authorization")), ["Queued", "Not sent", "Awaiting", "20d"]);
    assert.deepEqual(await documentState(row("Funding Signed")), ["Generated", "Sent", "Signed", "—"]);
    assert.deepEqual(await documentState(row("Identity Upload")), ["Generated", "N/A", "N/A", "—"]);
  });
  await prove(t, exercised, "607570c414ad961bd536", async () => {
    await row("Identity Upload").locator('[data-dl="d-upload"]').click();
    await documents.waitForFunction(() => window.__opened.length === 1);
    assert.match(documentLinkReads.at(-1), /\/api\/documents-download\?id=d-upload$/);
    assert.deepEqual((await documents.evaluate(() => window.__opened)).at(-1), {
      url: "https://signed.example.test/d-upload?sig=proof", target: "_blank", features: "noopener",
    });
  });
  await prove(t, exercised, "136cf9c3bf4ad280959d", async () => {
    const expected = new Map([
      ["Funding Draft", "draft"], ["Funding Sent", "sent"], ["Repair Opened", "opened"],
      ["Funding Signed", "signed"], ["Repair Void", "void"],
    ]);
    for (const [title, status] of expected) {
      assert.equal(await row(title).locator("td:last-child .badge").textContent(), status);
    }
  });
  await prove(t, exercised, "dff43b6cc64f22d8b6e6", async () => {
    await row("Funding Signed").locator('[data-ct="open"]').click();
    await documents.waitForFunction(() => window.__downloads.some((item) => item.download === "signed-funding.pdf"));
    assert.match(contractFileReads.at(-1), /file=contract/);
    assert.match(contractFileReads.at(-1), /id=ct-signed/);
    assert.match(contractFileReads.at(-1), /signed=1/);
    assert.deepEqual((await documents.evaluate(() => window.__downloads)).at(-1), { href: "blob:display-ab-proof", download: "signed-funding.pdf" });
  });
  await prove(t, exercised, "9422417593e9985f46c7", async () => {
    await row("Funding Sent").locator('[data-ct="remind"]').click();
    await documents.waitForFunction(() => document.querySelector("#ctMsg")?.textContent?.includes("Reminder queued for Sent Client."));
    assert.deepEqual(documentWrites.at(-1), { action: "remind", id: "ct-sent" });
    assert.match(await documents.locator("#ctMsg").innerText(), /done[\s\S]*Reminder queued for Sent Client\./i);
  });
  await prove(t, exercised, "f4462036525dee4be15b", async () => {
    documents.once("dialog", (dialog) => dialog.accept("Client chose the repair plan"));
    await row("Funding Draft").locator('[data-ct="void"]').click();
    await documents.waitForFunction(() => document.querySelector("#ctMsg")?.textContent?.includes("Contract voided for the saved reason."));
    assert.deepEqual(documentWrites.at(-1), { action: "void", id: "ct-draft", reason: "Client chose the repair plan" });
    assert.match(await documents.locator("#ctMsg").innerText(), /done[\s\S]*Contract voided for the saved reason\./i);
  });
  await prove(t, exercised, "a0f7a318f0d6c2879e0b", async () => {
    assert.ok(await documents.locator('[data-ct="void"]').count() > 0, "owner must see Void");
    const closer = await proofPage(browser, documentApi("closer"), "closer");
    await closer.goto(`${origin}/app/documents.html`, { waitUntil: "domcontentloaded" });
    await closer.waitForFunction(() => document.querySelectorAll("#body tr").length === 9 && document.querySelectorAll("#body td:last-child .badge").length === 5);
    assert.equal(await closer.locator('[data-ct="void"]').count(), 0);
    assert.ok(await closer.locator('[data-ct="remind"]').count() > 0, "closer still sees allowed Remind");
    await closer.close();
  });
  await documents.close();

  assert.deepEqual(
    [...exercised].sort(),
    [...DISPLAY_CONTRACT_KEYS_AB].sort(),
    "every exported Display AB row key must have a direct rendered assertion",
  );
});
