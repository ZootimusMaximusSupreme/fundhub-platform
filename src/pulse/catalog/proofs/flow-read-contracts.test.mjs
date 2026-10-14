import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import generated from "../generated.json" with { type: "json" };
import {
  FLOW_READ_CONTRACTS,
  FLOW_READ_CONTRACT_ROW_KEYS,
  FLOW_READ_CURRENT_RED_COUNTS,
  FLOW_READ_UNPROVED,
  flowReadContractProof,
  flowReadContractRowKey,
} from "./flow-read-contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) => candidate.startsWith(PUBLIC) && fs.existsSync(candidate));
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
      "content-type": CONTENT_TYPES.get(path.extname(file)) || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function renderedPage(browser, { role = "owner", routes = [], session = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const apiCalls = [];
  await page.addInitScript((wantedRole) => {
    localStorage.setItem("fh_token", "flow-read-proof-token");
    localStorage.setItem("fh_role", wantedRole);
    localStorage.removeItem("fh_demo");
  }, role);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    apiCalls.push({ pathname: url.pathname, method });
    const handler = routes.find((entry) => (
      entry.pathname === url.pathname && (!entry.method || entry.method === method)
    ));
    if (handler) {
      const body = typeof handler.body === "function"
        ? await handler.body({ route, url, method })
        : handler.body;
      return json(route, body, handler.status || 200);
    }
    if (url.pathname === "/api/auth/session" || url.pathname === "/api/session") {
      return json(route, session || {
        ok: true,
        staff: {
          id: "proof-staff",
          name: "Proof Person",
          email: "proof@example.test",
          role,
          org_id: "proof-org",
          status: "active",
        },
      });
    }
    return json(route, { ok: true, items: [], groups: [], pages: [] });
  });
  return { context, page, apiCalls };
}

function proofById(id) {
  const proof = FLOW_READ_CONTRACTS.find((entry) => entry.generatedId === id);
  assert.ok(proof, `missing proof definition ${id}`);
  return proof;
}

test("the shard exports exact proof metadata and an honest freshly compiled 50-row partition", () => {
  assert.deepEqual(FLOW_READ_CURRENT_RED_COUNTS, {
    flow: 23,
    read: 27,
    total: 50,
    proved: 12,
    unproved: 40,
  });
  assert.equal(FLOW_READ_CONTRACT_ROW_KEYS.length, 12);
  assert.equal(new Set(FLOW_READ_CONTRACT_ROW_KEYS).size, 12);
  assert.equal(FLOW_READ_UNPROVED.length, 40);

  const unprovedKeys = new Set(FLOW_READ_UNPROVED.map((row) => (
    flowReadContractRowKey(row.sourceFile, row)
  )));
  let wired = 0;
  let stillRed = 0;
  for (const entry of FLOW_READ_CONTRACTS) {
    assert.equal(entry.key, flowReadContractRowKey(entry.sourceFile, entry));
    assert.deepEqual(flowReadContractProof(entry.sourceFile, entry), entry.proof);
    assert.equal(entry.proof.depth, "e2e");
    assert.equal(entry.proof.runner, "real-rendered-page");
    assert.equal(entry.proof.asserts, entry.control);
    assert.equal(unprovedKeys.has(entry.key), false, entry.key);

    const catalog = generated.items.find((row) => row.id === entry.generatedId);
    assert.ok(catalog, entry.generatedId);
    assert.equal(catalog.sourceFile, entry.sourceFile);
    assert.equal(catalog.surface, entry.surface);
    assert.equal(catalog.proofAsserts, entry.control);
    assert.equal(catalog.proofVerdict, undefined, `${entry.generatedId} stayed explicitly red after compile`);
    assert.ok(["e2e", "deep"].includes(catalog.proofDepth));
    assert.ok(catalog.proof.tests.length > 0, `${entry.generatedId} lost its executable proof target`);
    if (catalog.state === "wired") {
      wired += 1;
      assert.match(catalog.reason, /Mapped to .* executable proof target/);
    } else {
      stillRed += 1;
      assert.equal(catalog.state, "red");
      assert.match(catalog.reason, /below required level/);
    }
  }
  assert.deepEqual({ wired, stillRed }, { wired: 11, stillRed: 1 });
});

test("every exported proof key is exercised by its real rendered page", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const exercised = new Set();
  const allApiCalls = [];
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  async function usePage(options, run) {
    const opened = await renderedPage(browser, options);
    try {
      await run(opened.page);
      allApiCalls.push(...opened.apiCalls);
    } finally {
      await opened.context.close();
    }
  }
  function proved(id) {
    exercised.add(proofById(id).key);
  }

  const staff = [
    { id: "staff-owner", name: "Alice Owner", role: "owner", status: "active" },
    { id: "staff-sales", name: "Sam Manager", role: "sales_manager", status: "active" },
  ];
  const agent = {
    code: "AG-PROOF",
    name: "Proof Follow-up",
    agent_class: "client_facing",
    channel: "sms",
    status: "draft",
    runtime: "internal",
    owner_label: "Alice Owner",
    prompt: "Follow up with the client using the saved facts and ask one clear question at a time.",
    guardrails: {
      block: "Never invent a dollar, approval, score, date, or client fact.",
      triggers: ["lead.created"],
      escalation: { path: "Sam Manager · Sales Manager", after: "1 hour", when: "client asks for a person" },
    },
    prompt_missing: false,
    guardrails_missing: false,
  };
  // A draft with nothing written yet: every rule of the promotion gate fails on it.
  const bareAgent = {
    ...agent, code: "AG-BARE", name: "Bare Draft", prompt: "", prompt_missing: true, guardrails_missing: true,
    guardrails: { block: "", triggers: [], escalation: {} },
  };
  await usePage({ routes: [
    { pathname: "/api/read/staff", body: { ok: true, items: staff } },
    { pathname: "/api/read/agents", body: { ok: true, items: [agent, bareAgent] } },
    { pathname: "/api/read/agent-shadow-log", body: { ok: true, rows: [], log: [] } },
  ] }, async (page) => {
    await page.goto(`${origin}/app/agent-editor.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#a_name")?.value === "Proof Follow-up");
    assert.deepEqual(await page.locator("#a_owner option").allTextContents(), [
      "Pick a person", "Alice Owner", "Sam Manager",
    ]);
    assert.equal(await page.locator("#a_owner").inputValue(), "Alice Owner");
    assert.deepEqual(await page.locator("#a_esc option").allTextContents(), [
      "Pick a person", "Alice Owner · Owner", "Sam Manager · Sales Manager",
    ]);
    assert.equal(await page.locator("#a_esc").inputValue(), "Sam Manager · Sales Manager");
    proved("56ed07305fff5647c76a");

    const gateRows = await page.locator("#gateBox .gaterow").allInnerTexts();
    assert.deepEqual(gateRows.slice(0, 4), [
      "●\nHas at least one trigger event\n1 selected",
      "●\nPrompt is written\n85 chars · 60 min",
      "●\nGuardrail block is not empty\n61 chars · 20 min",
      "●\nEscalation path is set\nSam Manager · Sales Manager",
    ]);
    assert.equal(await page.locator("#gateBox .gaterow.pass").count(), 6);

    // A draft with nothing written: all four rules fail, and no trigger reads "0 selected".
    await page.evaluate(() => document.querySelectorAll("details").forEach((card) => { card.open = true; }));
    const gateRow = (index) => page.locator("#gateBox .gaterow").nth(index);
    const cleared = async (index) => (await gateRow(index).getAttribute("class")).split(" ").includes("pass");
    await page.locator('.aitem[data-a="AG-BARE"]').click();
    await page.waitForFunction(() => document.querySelector("#a_name")?.value === "Bare Draft");
    assert.deepEqual(await Promise.all([0, 1, 2, 3].map(cleared)), [false, false, false, false]);
    assert.match(await gateRow(0).innerText(), /0 selected/);
    assert.match(await gateRow(1).innerText(), /0 chars · 60 min/);
    assert.match(await gateRow(2).innerText(), /0 chars · 20 min/);
    assert.match(await gateRow(3).innerText(), /none/);
    await page.locator('.aitem[data-a="AG-PROOF"]').click();
    await page.waitForFunction(() => document.querySelector("#a_name")?.value === "Proof Follow-up");
    await page.evaluate(() => document.querySelectorAll("details").forEach((card) => { card.open = true; }));

    // The edges of each rule: a row fails at one character under its minimum and passes at the minimum.
    for (const [field, index, minimum] of [["#a_prompt", 1, 60], ["#a_guard", 2, 20]]) {
      await page.locator(field).fill("x".repeat(minimum - 1));
      assert.equal(await cleared(index), false, `${field} at ${minimum - 1} characters`);
      assert.match(await gateRow(index).innerText(), new RegExp(`${minimum - 1} chars · ${minimum} min`));
      await page.locator(field).fill("x".repeat(minimum));
      assert.equal(await cleared(index), true, `${field} at ${minimum} characters`);
    }
    await page.locator("#a_prompt").fill(" ".repeat(80));
    assert.equal(await cleared(1), false, "spaces do not count as a prompt");
    await page.locator("#a_esc").selectOption("");
    assert.equal(await cleared(3), false, "no escalation person");
    await page.locator("#a_esc").selectOption({ label: "Sam Manager · Sales Manager" });
    assert.equal(await cleared(3), true);
    proved("f2208943199577941fde");
  });

  await usePage({ routes: [
    { pathname: "/api/read/affiliates", body: { ok: true, items: [{ id: "aff-1", license_signed: false }] } },
    { pathname: "/api/read/affiliate-portal", body: {
      ok: true,
      enrolled: true,
      affiliate: { id: "aff-1", name: "Ava Affiliate", code: "FH1042", offerLinks: [] },
      rates: { direct: null, downline: null },
      referrals: [],
      payouts: [],
      gates: { license: { signed: false, documentRef: "license-proof.pdf" }, tax: { onFile: true } },
    } },
  ], session: { ok: true, staff: { id: "staff-aff", affiliate_id: "aff-1", name: "Ava Affiliate", role: "owner", org_id: "proof-org", status: "active" } } }, async (page) => {
    await page.goto(`${origin}/app/affiliate.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#affLicenseChip")).display !== "none");
    assert.equal(await page.locator("#licenseBanner").isVisible(), true);
    assert.match(await page.locator("#licenseBannerBody").textContent(), /license-proof\.pdf/);
    assert.equal(await page.locator("#affLicenseChip").isVisible(), true);
    assert.equal((await page.locator("#affLicenseChip").innerText()).trim(), "LICENSE UNSIGNED");
    proved("367dca0db64096fe33fd");
  });

  const campaign = {
    id: "camp-1", name: "Proof Campaign", platform: "meta", offer_type: "funding_dfy",
    approval_state: "live", strategy_key: "scale_winner", budget_cents: 500000,
    spend_yesterday_cents: 12345, roas_7d: 2.5, ad_set_count: 1, ad_count: 1,
    has_disclosure_asset: true, special_ad_category: "CREDIT", status: "ACTIVE",
    synced_at: "2026-10-12T12:00:00Z", created_at: "2026-10-01T12:00:00Z",
    approved_at: "2026-10-02T12:00:00Z", last_error: null,
  };
  await usePage({ routes: [
    { pathname: "/api/read/partners", body: { ok: true, items: [{ id: "partner-1", name: "Proof Partner", slug: "proof" }] } },
    { pathname: "/api/campaigns/spend", body: { ok: true, items: [] } },
    { pathname: "/api/campaigns/list", body: { ok: true, items: [campaign] } },
    { pathname: "/api/campaigns/fatigue", body: { ok: true, items: [{
      ad_name: "Hook A", ad_id: "ad-123456789", campaign_name: "Proof Campaign", platform: "meta",
      spend_cents: 12345, impressions: 10000, frequency: 3.25, ctr: 1.5, roas: 2.1,
      last_date: "2026-10-12", rotated_at: null, hours_until_next_rotation: 6, recommendation: "refresh",
    }] } },
    { pathname: "/api/campaigns/connections", body: { ok: true, items: [{
      id: "conn-1", platform: "meta", external_ad_account_id: "act-77", external_business_id: "biz-8",
      connection_state: "active", platform_verification_state: "approved", has_access_token: true,
      token_expired: false, token_expires_at: "2026-12-01T12:00:00Z", has_refresh_token: true,
      last_synced_at: "2026-10-12T12:00:00Z", campaign_count: 1,
      can_launch: false, can_launch_credit_offer: true,
      blockers: [{ severity: "blocker", task_key: "verify_business", title: "Verify business", detail: "Meta must approve it." }],
      last_error: null,
    }] } },
    { pathname: "/api/campaigns/action-log", body: { ok: true, items: [] } },
    { pathname: "/api/read/ad-books", body: { ok: true, groups: [], total_leads: 0, total_books: 0, unknown_ad_ids: [] } },
    { pathname: "/api/read/funnel-pages", body: { ok: true, pages: [], connection: null } },
    { pathname: "/api/read/ad-spine", body: { ok: true, items: [], hasMore: false, limit: 200 } },
  ] }, async (page) => {
    await page.goto(`${origin}/app/campaign-manager.html?partner_id=partner-1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#footNote")?.textContent === "5 of 5 panels loaded");
    const fatigue = page.locator("#fatRows tr").first();
    assert.match(await fatigue.innerText(), /Hook A[\s\S]*3\.25[\s\S]*1\.50%[\s\S]*2\.10[\s\S]*refresh/i);
    assert.equal((await fatigue.locator('button[data-link-ad="ad-123456789"]').textContent()).trim(), "Label…");
    assert.equal(await fatigue.locator("button").getAttribute("data-link-name"), "Hook A");
    proved("b79b6c45d9c1a7d5928e");

    const connection = page.locator("#connRows tr").first();
    const cells = connection.locator("td");
    assert.equal((await cells.nth(6).textContent()).trim(), "no");
    assert.equal((await cells.nth(7).textContent()).trim(), "yes");
    assert.match(await connection.innerText(), /active[\s\S]*approved[\s\S]*valid[\s\S]*Verify business/i);
    proved("da8a4cf5de4439e625b9");
  });

  await usePage({ role: "client", session: { ok: true, staff: { id: "client-1", name: "Dana Client", role: "client", org_id: "proof-org", status: "active" } }, routes: [
    { pathname: "/api/read/portal-contracts", body: { ok: true, items: [{
      id: "agreement-1", title: "Funding Agreement", status: "sent", needs_signature: true,
      sent_at: "2026-10-12T12:00:00Z", sign_url: "https://fundhub.ai/contracts/sign/proof-token",
    }] } },
    { pathname: "/api/read/portal-summary", body: { ok: true, documents: [], soft_pull_complete: false, scores: {} } },
    { pathname: "/api/read/affiliate-portal", body: { ok: true, enrolled: false, referrals: [], payouts: [], gates: null } },
  ] }, async (page) => {
    await page.goto(`${origin}/app/client-portal.html?id=client-1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !document.querySelector("#agreements-card")?.hidden);
    assert.match(await page.locator("#agreements-list").innerText(), /Funding Agreement[\s\S]*Needs signature/);
    const link = page.locator('#agreements-list a:has-text("Review & sign")');
    assert.equal(await link.getAttribute("href"), "https://fundhub.ai/contracts/sign/proof-token");
    await page.locator("#acct > summary").click();
    await page.locator('button[data-tab="agree"]').click();
    assert.match(await page.locator("#tp-agree").innerText(), /Funding Agreement[\s\S]*Needs signature/);
    proved("870fcdab3aeb38c897d2");
  });

  await usePage({ role: "closer", routes: [
    { pathname: "/api/read/my-numbers", body: {
      ok: true,
      staff_id: "proof-staff",
      shift: { on_shift: false },
      pace: {},
      offer_stack_scope: { note: "Only this closer" },
      offer_stack: {
        available: true,
        period: { label: "October 2026" },
        reason: "No sale facts were stored.",
        items: [
          { name: "Funding DFY", active: true, units: 2, sold_cents: 600000, sold_display: "$6,000", collected_cents: 300000, collected_display: "$3,000", refunded_cents: 0 },
          { name: "Old Course", active: false, units: null, units_reason: "Units are unknown.", sold_cents: null, sold_reason: "Amount sold is unknown.", collected_cents: null, collected_reason: "Cash collected is unknown." },
        ],
        totals: { units: 2, sold_cents: 600000, sold_display: "$6,000", collected_cents: 300000, collected_display: "$3,000", refunded_cents: 0 },
      },
      month: {},
      money: { paid_cents: 125000, paid_display: "$1,250", pending_cents: 250000, pending_display: "$2,500", at_risk_reason: "Not computed from a stored fact." },
      streak: { reason: "Daily close streak is not stored yet." },
      team: [], owed: [], call_quality: {},
    } },
  ] }, async (page) => {
    await page.goto(`${origin}/app/my-numbers.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#stackBody")?.textContent?.includes("Funding DFY"));
    const stack = await page.locator("#stackBody").innerText();
    assert.match(stack, /Funding DFY[\s\S]*2[\s\S]*\$6,000[\s\S]*\$3,000/);
    assert.match(stack, /Old Course[\s\S]*retired product[\s\S]*Units are unknown\.[\s\S]*Amount sold is unknown\.[\s\S]*Cash collected is unknown\./);
    assert.match(stack, /All products[\s\S]*2[\s\S]*\$6,000[\s\S]*\$3,000/);
    proved("c0d4748535fa446d98b1");

    const boxes = await page.locator(".money").innerText();
    assert.match(boxes, /Paid out[\s\S]*\$1,250/i);
    assert.match(boxes, /Pending funding[\s\S]*\$2,500/i);
    assert.match(boxes, /At risk[\s\S]*—[\s\S]*Not computed from a stored fact\./i);
    proved("747ccb28609f24e35b68");

    assert.equal((await page.locator(".days").innerText()).trim(), "Daily close streak is not stored yet.");
    proved("45fc2cb4fdba76f0538b");
  });

  await usePage({ routes: [
    { pathname: "/api/read/partners", body: { ok: true, items: [
      { id: "partner-1", name: "One" }, { id: "partner-2", name: "Two" }, { id: "partner-3", name: "Three" },
    ] } },
  ] }, async (page) => {
    await page.goto(`${origin}/app/partner-galaxy.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#census")?.textContent?.includes("3 partners on file"));
    assert.equal((await page.locator("#census").innerText()).trim(), "3 partners on file");
    await page.waitForTimeout(1200);
    assert.equal((await page.locator("#census").innerText()).trim(), "3 partners on file");
    proved("9d48b89fdafd94c59f58");
  });

  await usePage({ routes: [
    { pathname: "/api/read/slo-connections", body: { ok: true, items: [
      { id: "slo-1", name: "Course SLO", cf_funnel_id: "funnel-77", cf_product_id: "cf-product-88", product_name: "Funding Mastery", active: true },
      { id: "slo-2", name: "Old SLO", cf_funnel_id: "funnel-99", cf_product_id: "cf-product-00", product_name: "Old Course", active: false },
    ] } },
  ] }, async (page) => {
    await page.goto(`${origin}/app/products-commissions.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !document.querySelector("#sloTab")?.hidden);
    await page.locator("#sloTab").click();
    await page.waitForFunction(() => document.querySelectorAll("#sloBody tr").length === 2);
    assert.match(await page.locator("#sloBody").innerText(), /Course SLO[\s\S]*funnel-77[\s\S]*cf-product-88[\s\S]*Funding Mastery[\s\S]*On/i);
    assert.match(await page.locator("#sloBody").innerText(), /Old SLO[\s\S]*funnel-99[\s\S]*cf-product-00[\s\S]*Old Course[\s\S]*Off/i);
    assert.equal(await page.locator("#sloLiveCount").textContent(), "1");
    proved("c476a7ee639a0cfe6488");
  });

  await usePage({}, async (page) => {
    await page.route("https://apply.fundhub.ai/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Proof calendar</title>" });
    });
    await page.goto(`${origin}/optimize.html`, { waitUntil: "domcontentloaded" });
    assert.equal(await page.locator("#first").inputValue(), "");
    assert.equal(await page.locator("#last").inputValue(), "");
    assert.equal(await page.locator("#phone").inputValue(), "");
    await Promise.all([
      page.waitForURL("https://apply.fundhub.ai/schedule/phonecall"),
      page.locator("#book").click(),
    ]);
    assert.equal(page.url(), "https://apply.fundhub.ai/schedule/phonecall");
    proved("d00cbba31d2f71b4516c");
  });

  assert.equal(allApiCalls.every((call) => call.method === "GET"), true, JSON.stringify(allApiCalls));
  assert.deepEqual([...exercised].sort(), [...FLOW_READ_CONTRACT_ROW_KEYS].sort());
});
