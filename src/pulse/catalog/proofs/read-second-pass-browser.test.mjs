import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

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

async function newPage(browser, routes) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "read-proof-token");
    localStorage.setItem("fh_role", "owner");
    localStorage.removeItem("fh_demo");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const handler = routes.find((entry) => entry.match(url, route.request().method()));
    if (handler) return json(route, handler.body, handler.status || 200);
    if (url.pathname === "/api/auth/session" || url.pathname === "/api/session") {
      return json(route, {
        ok: true,
        staff: {
          id: "staff-1",
          affiliate_id: "aff-1",
          name: "Ava Affiliate",
          email: "ava@example.test",
          role: "owner",
          org_id: "org-1",
          status: "active",
        },
      });
    }
    return json(route, { ok: true, items: [], groups: [], pages: [] });
  });
  return page;
}

test("affiliate source values render as exact figures, gates, rows, and money", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const page = await newPage(browser, [
    {
      match: (url) => url.pathname === "/api/read/affiliates",
      body: {
        ok: true,
        items: [{
          id: "aff-1",
          tracking_id: "FH1042",
          license_signed: false,
          balance_due: "1250.50",
          referred_count: 4,
          referred_untracked: 1,
          converted_count: 2,
          unrated_converted_count: 1,
          clicks_count: 10,
          clicks_30d: 7,
          paid_total: "600.00",
          paid_runs: 1,
        }],
      },
    },
    {
      match: (url) => url.pathname === "/api/read/affiliate-portal",
      body: {
        ok: true,
        enrolled: true,
        affiliate: {
          id: "aff-1",
          name: "Ava Affiliate",
          code: "FH1042",
          offerLinks: [{ name: "Capital Blueprint", url: "https://fundhub.ai/start?ref=FH1042" }],
        },
        rates: { direct: { percent: 20, rules: [{}] }, downline: { percent: 5 } },
        gates: {
          license: { signed: false, documentRef: "license-2026.pdf" },
          tax: { onFile: false },
        },
        referrals: [{
          attributedAt: "2026-10-10T12:00:00Z",
          name: "Lead One",
          status: "converted",
          product: "Funding",
          basisAmount: 3000,
          commissionDue: 600,
          tier: "direct",
        }],
        payouts: [{
          paidAt: "2026-10-11T12:00:00Z",
          periodStart: "2026-10-01T00:00:00Z",
          periodEnd: "2026-10-10T00:00:00Z",
          lineCount: 1,
          method: "ACH",
          amount: 600,
          status: "paid",
        }],
      },
    },
  ]);

  await page.goto(`${origin}/app/affiliate.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#kRef").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#kRef")?.textContent === "4");

  assert.equal(await page.locator("#kRef").textContent(), "4");
  assert.equal(await page.locator("#kConv").textContent(), "2");
  assert.equal(await page.locator("#kOwed").textContent(), "$1,250.50");
  assert.equal(await page.locator("#kPaid").textContent(), "$600.00");
  assert.match(await page.locator("#funnelBody").innerText(), /10[\s\S]*CLICKS[\s\S]*4[\s\S]*REFERRED[\s\S]*2[\s\S]*CONVERTED/);

  assert.equal(await page.locator("#affCode").textContent(), "FH1042");
  assert.equal(await page.locator('#offerLinks input[aria-label="Capital Blueprint link"]').inputValue(), "https://fundhub.ai/start?ref=FH1042");
  assert.equal(await page.locator("#affRate").textContent(), "20%");
  assert.match(await page.locator("#affRateNote").textContent(), /5% on their referrals/);
  assert.equal(await page.locator("#licenseBanner").isVisible(), true);
  assert.match(await page.locator("#licenseBanner").innerText(), /license-2026\.pdf/);
  assert.equal(await page.locator("#taxBanner").isVisible(), true);
  assert.match(await page.locator("#leadBody").innerText(), /Lead One[\s\S]*Funding[\s\S]*\$600\.00/);
  assert.match(await page.locator("#payBody").innerText(), /ACH[\s\S]*\$600\.00[\s\S]*Paid/);
});

test("saved partner brand values render in the real preview and locked card", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const page = await newPage(browser, [
    {
      match: (url) => url.pathname === "/api/partner-brand",
      body: {
        ok: true,
        brand: {
          ink: "#112233",
          paper: "#F4F1EA",
          ramp: ["#112233", "#334455", "#556677", "#778899", "#99AABB", "#CCDDEE"],
          display_face: "DM Serif Display",
          mono_face: "IBM Plex Mono",
          wordmark_url: "https://assets.example.test/mesa-wordmark.png",
          entity_name: "Mesa Capital LLC",
          entity_address: "1 Main Street, Phoenix, AZ",
          voice: "Clear and direct",
          support_email: "help@mesa.example",
          domain: "mesa.example",
          domain_verified: true,
          selected_funnels: ["apply"],
          approval_status: "approved",
        },
      },
    },
    {
      match: (url) => url.pathname === "/api/partner-pages",
      body: {
        ok: true,
        items: [{
          id: "page-1",
          funnel_key: "apply",
          title: "Apply",
          slug: "apply",
          status: "published",
          live_path: "/sites/mesa/apply",
          body_json: { sections: [{ id: "hero", headline: "Exact funding headline", sub: "Exact funding subhead" }] },
        }],
      },
    },
    {
      match: (url) => url.pathname === "/api/partner-marketing/usage",
      body: { ok: true, enabled: true, remaining: 9, cap: 10, used: 1 },
    },
  ]);

  await page.goto(`${origin}/app/brand-studio.html?partner_id=partner-1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#saveMsg")?.textContent === "Loaded your saved brand.");
  await page.waitForFunction(() => document.querySelector("#pvH1")?.textContent === "Exact funding headline");

  assert.equal(await page.locator("#bEntity").inputValue(), "Mesa Capital LLC");
  assert.equal(await page.locator("#bAddr").inputValue(), "1 Main Street, Phoenix, AZ");
  assert.equal(await page.locator("#pvUrl").textContent(), "mesa.example");
  assert.equal(await page.locator("#pvH1").textContent(), "Exact funding headline");
  assert.equal(await page.locator("#pvSub").textContent(), "Exact funding subhead");
  assert.match(await page.locator("#pvLegal").textContent(), /Mesa Capital LLC/);
  assert.equal(await page.locator("#entEcho").textContent(), "Mesa Capital LLC");
  assert.equal(await page.locator("#kDomain").textContent(), "DNS verified");
  assert.equal(await page.locator("#kFun").textContent(), "1");
  assert.equal(await page.locator("#pvWm img").getAttribute("src"), "https://assets.example.test/mesa-wordmark.png");

  const locked = page.locator(".locked .lk");
  assert.equal(await locked.count(), 5);
  const lockedText = await locked.allInnerTexts();
  assert.deepEqual(lockedText, [
    'Funding disclosures and "not a direct lender" language',
    "SMS consent, STOP/HELP handling, A2P registration",
    "Privacy Policy, Terms of Service, SMS Terms, Refund Policy",
    "Guarantee language and its conditions",
    "FCRA, E-SIGN, and GLBA handling statements",
  ]);
});

test("campaign source values render in every named read panel and summary", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const campaign = {
    id: "camp-1",
    name: "Launch Fundhub",
    platform: "meta",
    offer_type: "funding_dfy",
    approval_state: "live",
    strategy_key: "scale_winner",
    budget_cents: 500000,
    spend_yesterday_cents: 12345,
    roas_7d: 2.5,
    ad_set_count: 2,
    ad_count: 3,
    has_disclosure_asset: false,
    special_ad_category: null,
    status: "ACTIVE",
    synced_at: "2026-10-12T12:00:00Z",
    created_at: "2026-10-01T12:00:00Z",
    approved_at: "2026-10-02T12:00:00Z",
    last_error: null,
  };
  const page = await newPage(browser, [
    {
      match: (url) => url.pathname === "/api/read/partners",
      body: { ok: true, items: [{ id: "partner-1", name: "Mesa Partner", slug: "mesa" }] },
    },
    {
      match: (url) => url.pathname === "/api/campaigns/spend",
      body: { ok: true, items: [{
        scope: "partner",
        campaign_id: null,
        campaign_name: null,
        platform: "meta",
        daily_limit_cents: 100000,
        spend_today_cents: 85000,
        max_daily_increase_pct: 20,
        breached_at: "2026-10-12T10:00:00Z",
      }] },
    },
    {
      match: (url) => url.pathname === "/api/campaigns/list",
      body: { ok: true, items: [campaign] },
    },
    {
      match: (url) => url.pathname === "/api/campaigns/fatigue",
      body: { ok: true, items: [{
        ad_name: "Hook A",
        ad_id: "ad-123456789",
        campaign_name: "Launch Fundhub",
        platform: "meta",
        spend_cents: 12345,
        impressions: 10000,
        frequency: 3.25,
        ctr: 1.5,
        roas: 2.1,
        last_date: "2026-10-12",
        rotated_at: null,
        hours_until_next_rotation: 6,
        recommendation: "refresh",
      }] },
    },
    {
      match: (url) => url.pathname === "/api/campaigns/connections",
      body: { ok: true, items: [{
        id: "conn-1",
        platform: "meta",
        external_ad_account_id: "act-77",
        external_business_id: "biz-8",
        connection_state: "active",
        platform_verification_state: "approved",
        has_access_token: true,
        token_expired: false,
        token_expires_at: "2026-12-01T12:00:00Z",
        has_refresh_token: true,
        last_synced_at: "2026-10-12T12:00:00Z",
        campaign_count: 1,
        can_launch: false,
        can_launch_credit_offer: false,
        blockers: [{ severity: "blocker", task_key: "verify_business", title: "Verify business", detail: "Meta must approve it." }],
        last_error: null,
      }] },
    },
    {
      match: (url) => url.pathname === "/api/campaigns/action-log",
      body: { ok: true, items: [{
        id: "act-1",
        created_at: "2026-10-12T12:00:00Z",
        actor: "agent",
        agent_name: "Budget Guard",
        target_type: "campaign",
        target_id: "camp-1",
        rule_key: "kill_switch_ceiling",
        reason: "Daily limit reached",
        before: { budget_cents: 100000 },
        after: { budget_cents: 0 },
        execute_error: null,
        executed_at: "2026-10-12T12:00:01Z",
        undone_at: null,
        revertible: true,
        metrics_snapshot: {},
      }] },
    },
    {
      match: (url) => url.pathname === "/api/read/ad-books",
      body: {
        ok: true,
        groups: [{ key: "core", leads: 8, books: 2, first_book_at: "2026-10-01T12:00:00Z", last_book_at: "2026-10-12T12:00:00Z" }],
        total_leads: 8,
        total_books: 2,
        unknown_ad_ids: [],
      },
    },
    {
      match: (url) => url.pathname === "/api/read/funnel-pages",
      body: { ok: true, pages: [], connection: null },
    },
    {
      match: (url) => url.pathname === "/api/read/ad-spine",
      body: { ok: true, items: [], window: null, people_rows_in_window: 0, hasMore: false, limit: 200 },
    },
  ]);

  await page.goto(`${origin}/app/campaign-manager.html?partner_id=partner-1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#footNote")?.textContent === "5 of 5 panels loaded");

  assert.match(await page.locator("#partnerSel").innerText(), /Mesa Partner/);
  assert.equal(await page.locator("#partnerSel").inputValue(), "partner-1");
  assert.match(await page.locator(".topbar").innerText(), /amounts · the ad account's own currency/i);
  assert.match(await page.locator("#spendRows").innerText(), /partner[\s\S]*meta[\s\S]*1,000\.00[\s\S]*850\.00[\s\S]*150\.00[\s\S]*85\.00%[\s\S]*breached/i);
  assert.match(await page.locator("#adBooksRows").innerText(), /core[\s\S]*8[\s\S]*2[\s\S]*25\.00%/i);
  assert.match(await page.locator("#campRows").innerText(), /Launch Fundhub[\s\S]*meta[\s\S]*funding dfy[\s\S]*live[\s\S]*scale winner[\s\S]*5,000\.00[\s\S]*123\.45[\s\S]*2\.50[\s\S]*ACTIVE/i);
  assert.match(await page.locator("#fatRows").innerText(), /Hook A[\s\S]*Launch Fundhub[\s\S]*123\.45[\s\S]*10,000[\s\S]*3\.25[\s\S]*1\.50%[\s\S]*2\.10[\s\S]*refresh/i);
  assert.match(await page.locator("#connRows").innerText(), /act-77[\s\S]*biz biz-8[\s\S]*active[\s\S]*approved[\s\S]*valid[\s\S]*renewal key stored[\s\S]*Verify business[\s\S]*Meta must approve it\./i);
  assert.match(await page.locator("#logRows").innerText(), /Budget Guard[\s\S]*Launch Fundhub[\s\S]*daily limit hit[\s\S]*Daily limit reached[\s\S]*1,000\.00[\s\S]*0\.00[\s\S]*done[\s\S]*revertible/i);
  assert.equal(await page.locator("#ceilTxt").textContent(), "1 ceiling breached");
  const summary = await page.locator("#statRow").innerText();
  assert.match(summary, /SPEND TODAY[\s\S]*850\.00[\s\S]*85\.00%/);
  assert.match(summary, /HEADROOM TODAY[\s\S]*150\.00[\s\S]*1,000\.00 daily limit/);
  assert.match(summary, /SPEND YESTERDAY[\s\S]*123\.45/);
  assert.match(summary, /LIVE CAMPAIGNS[\s\S]*1 \/ 1/);
  assert.match(summary, /ROAS 7D[\s\S]*2\.50/);
});
