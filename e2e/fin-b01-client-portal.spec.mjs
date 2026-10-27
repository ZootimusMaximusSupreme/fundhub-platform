// Client portal: the FinanceOS card link, the Pay now link on each open invoice
// and the Refer a friend Copy button (finish-the-853, batch 01).
//
// Judged in a real page against fake answers: where each link goes and what it
// says for each answer the server can give, and what the Copy button puts on the
// clipboard.
//
// NO BACKEND: page.route() answers /api/**. Nobody is charged.
import { test, expect } from "@playwright/test";
import { CLIENT_ID, json } from "./harness.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

const CLIENT = { ok: true, staff: { id: CLIENT_ID, client_id: CLIENT_ID, name: "Dana Whitfield", email: "dana@example.com", role: "client", org_id: "org-1", status: "active" } };
const OWNER = { ok: true, staff: { id: "staff-1", name: "Jordan Blake", email: "jordan@fundhub.ai", role: "owner", org_id: "org-1", status: "active" } };

const SUMMARY = {
  ok: true, prequal_amount: null, prequal_display: null, soft_pull_complete: false,
  scores: { experian: null, equifax: null, transunion: null, experian_business: null },
  documents: [], payments: [],
};

async function openPortal(page, session, { summary = {}, readyToFund, affiliate, init, dashboard, dashboardHold, summaryHold } = {}) {
  const calls = { readyToFund: [] };
  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", (s.staff && s.staff.role) || "owner");
    localStorage.removeItem("fh_demo");
  }, session);
  if (init) await page.addInitScript(init);
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session") || /\/api\/session\b/.test(url)) return json(route, session);
    if (url.includes("/api/money/ready-to-fund")) {
      calls.readyToFund.push(url);
      if (readyToFund === undefined) return json(route, { ok: false }, 403);
      return json(route, readyToFund.body, readyToFund.status || 200);
    }
    // The staff read of one client's file (FHData.client): the paid list, with no bill in it.
    if (/\/api\/dashboard\/client\?/.test(url) && dashboard) {
      if (dashboardHold) await dashboardHold;
      return json(route, { ok: true, ...dashboard });
    }
    if (url.includes("/api/read/portal-summary")) {
      if (summaryHold) await summaryHold;
      return json(route, { ...SUMMARY, ...summary });
    }
    if (url.includes("/api/read/affiliate-portal")) {
      return json(route, affiliate || { ok: true, enrolled: false, affiliate: null, rates: { direct: null, downline: null }, referrals: [], payouts: [], gates: null });
    }
    return json(route, { ok: true, items: [] });
  });
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForLoadState("domcontentloaded");
  return calls;
}

test("a buyer sees a sample estimate plainly labeled and no real pull claim", async ({ page }) => {
  await openPortal(page, CLIENT, { summary: {
    prequal_amount: 410000, prequal_display: "$410,000", prequal_sample: true,
    soft_pull_complete: false
  } });
  await expect(page.locator("#sb-prequal-row .sb-eyebrow")).toHaveText("Sample estimate · not a real pre-qualification");
  await expect(page.locator("#sb-pre-main")).toHaveText("This is a sample estimate. No real soft pull has been run.");
  await expect(page.locator("#sb-prequal-amt")).toHaveText("$410,000");
});

test("a real pre-qualification keeps its ordinary buyer wording", async ({ page }) => {
  await openPortal(page, CLIENT, { summary: {
    prequal_amount: 50000, prequal_display: "$50,000", prequal_sample: false,
    soft_pull_complete: true
  } });
  await expect(page.locator("#sb-prequal-row .sb-eyebrow")).toHaveText("Pre-qualified for");
  await expect(page.locator("#sb-pre-main")).toContainText("Your soft-pull assessment is in");
});

test.describe("client portal: the FinanceOS card link", () => {
  test("by default the card says Open FinanceOS and goes to FinanceOS", async ({ page }) => {
    await openPortal(page, CLIENT);
    const card = page.locator("#money-link");
    await expect(card).toBeVisible();
    await expect(card.locator(".fb-go")).toHaveText("Open FinanceOS");
    await expect(card).toHaveAttribute("href", "/app/financeos.html");
  });

  test("a Capital Blueprint owner without FinanceOS is sent to FinanceOS setup, and the card says so", async ({ page }) => {
    await openPortal(page, CLIENT, {
      readyToFund: { body: { ok: true, offers: { blueprint: { owned: true }, financeos: { entitled: false } } } },
    });
    const card = page.locator("#money-link");
    await expect(card.locator(".fb-go")).toHaveText("Set up FinanceOS");
    await expect(card).toHaveAttribute("href", "/app/financeos.html#setup");
    await expect(card.locator(".fb-d")).toContainText("Add FinanceOS to your Capital Blueprint");
  });

  test("a client who already has FinanceOS keeps the plain Open card", async ({ page }) => {
    await openPortal(page, CLIENT, {
      readyToFund: { body: { ok: true, offers: { blueprint: { owned: true }, financeos: { entitled: true } } } },
    });
    const card = page.locator("#money-link");
    await expect(card.locator(".fb-go")).toHaveText("Open FinanceOS");
    await expect(card).toHaveAttribute("href", "/app/financeos.html");
  });

  test("a client without the Capital Blueprint keeps the plain Open card", async ({ page }) => {
    await openPortal(page, CLIENT, {
      readyToFund: { body: { ok: true, offers: { blueprint: { owned: false }, financeos: { entitled: false } } } },
    });
    await expect(page.locator("#money-link .fb-go")).toHaveText("Open FinanceOS");
    await expect(page.locator("#money-link")).toHaveAttribute("href", "/app/financeos.html");
  });

  test("staff opening a client's portal get the client's own id on the Open link, and on Set up", async ({ page }) => {
    await openPortal(page, OWNER, {
      readyToFund: { body: { ok: true, offers: { blueprint: { owned: true }, financeos: { entitled: false } } } },
    });
    await expect(page.locator("#money-link .fb-go")).toHaveText("Set up FinanceOS");
    await expect(page.locator("#money-link")).toHaveAttribute("href", `/app/financeos.html?client_id=${CLIENT_ID}#setup`);
  });

  test("staff with no side-sell answer get the client's id on the plain Open link", async ({ page }) => {
    await openPortal(page, OWNER);
    await expect(page.locator("#money-link .fb-go")).toHaveText("Open FinanceOS");
    await expect(page.locator("#money-link")).toHaveAttribute("href", `/app/financeos.html?client_id=${CLIENT_ID}`);
  });
});

const link = (page) => page.locator("#tp-pay a.btn-unlock");

test.describe("client portal: Payments tab, Pay now per open invoice", () => {
  test("each open invoice gets its own Pay now link to the invoice's own pay address", async ({ page }) => {
    await openPortal(page, CLIENT, {
      summary: {
        invoice_due: { count: 2, items: [
          { kind: "Success fee", reference: "INV-1001", amount_display: "$4,500.00", pay_url: "https://pay.example.test/inv-1001" },
          { kind: "Setup", reference: "INV-1002", amount_display: "$497.00", pay_url: "https://pay.example.test/inv-1002" },
        ] },
        payments: [],
      },
    });
    await expect(link(page)).toHaveCount(2);
    await expect(link(page).nth(0)).toHaveAttribute("href", "https://pay.example.test/inv-1001");
    await expect(link(page).nth(1)).toHaveAttribute("href", "https://pay.example.test/inv-1002");
    await expect(link(page).nth(0)).toHaveText("Pay now");
    await expect(link(page).nth(0)).toHaveAttribute("target", "_blank");
    await expect(link(page).nth(0)).toHaveAttribute("rel", /noopener/);
    const rows = page.locator("#tp-pay .pay-row");
    await expect(rows.nth(0)).toContainText("Success fee · INV-1001");
    await expect(rows.nth(0)).toContainText("$4,500.00");
    await expect(rows.nth(1)).toContainText("$497.00");
  });

  test("an invoice with no pay address shows its amount and no Pay now link", async ({ page }) => {
    await openPortal(page, CLIENT, {
      summary: { invoice_due: { count: 1, items: [{ kind: "Setup", reference: "INV-1", amount_display: "$497.00", pay_url: null }] } },
    });
    await expect(page.locator("#tp-pay")).toContainText("$497.00");
    await expect(link(page)).toHaveCount(0);
  });

  test("a pay address that is not http or https is never drawn as a link", async ({ page }) => {
    await openPortal(page, CLIENT, {
      summary: { invoice_due: { count: 1, items: [{ kind: "Setup", reference: "INV-1", amount_display: "$497.00", pay_url: "javascript:alert(1)" }] } },
    });
    await expect(page.locator("#tp-pay")).toContainText("$497.00");
    await expect(link(page)).toHaveCount(0);
  });

  test("a bill that could not be read says so, and does not claim nothing is owed", async ({ page }) => {
    await openPortal(page, CLIENT, { summary: { invoice_due: null } });
    await expect(page.locator("#tp-pay")).toContainText("We could not check what you owe");
    await expect(page.locator("#tp-pay")).not.toContainText("No payments yet");
    await expect(link(page)).toHaveCount(0);
  });

  test("with an empty bill and no payments the tab says No payments yet and has no link", async ({ page }) => {
    await openPortal(page, CLIENT, { summary: { invoice_due: { count: 0, items: [] }, payments: [] } });
    await expect(page.locator("#tp-pay")).toContainText("No payments yet");
    await expect(link(page)).toHaveCount(0);
  });
});

/* STAFF open a client's portal. They get the paid list from /api/dashboard/client and the bill from
   portal-summary's invoice_due (paintStaffPays, added for the live miss of 2026-09-18). Every test
   above opens as the client, so a staff view that dropped the bill stayed green. */
const STAFF_FILE = {
  client: { id: CLIENT_ID, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com" },
  transactions: [{ product_name: "Roadmap", amount_paid: "$297.00", status: "paid", created_at: "2026-10-01T10:00:00Z" }],
  messages: [], latest_booking: null,
};
const BILL = { invoice_due: { count: 2, items: [
  { kind: "Success fee", reference: "INV-2001", amount_display: "$4,500.00", pay_url: "https://pay.example.test/inv-2001" },
  { kind: "Setup", reference: "INV-2002", amount_display: "$497.00", pay_url: "https://pay.example.test/inv-2002" },
] } };

test.describe("client portal: Payments tab as staff, Pay now per open invoice", () => {
  test("staff see each open invoice's own Pay now link, beside what was already paid", async ({ page }) => {
    await openPortal(page, OWNER, { dashboard: STAFF_FILE, summary: BILL });
    await expect(link(page)).toHaveCount(2);
    await expect(link(page).nth(0)).toHaveAttribute("href", "https://pay.example.test/inv-2001");
    await expect(link(page).nth(1)).toHaveAttribute("href", "https://pay.example.test/inv-2002");
    await expect(link(page).nth(0)).toHaveText("Pay now");
    await expect(page.locator("#tp-pay .pay-row").nth(0)).toContainText("Success fee · INV-2001");
    await expect(page.locator("#tp-pay .pay-row").nth(0)).toContainText("$4,500.00");
    // The paid list from the staff read is still there.
    await expect(page.locator("#tp-pay")).toContainText("Roadmap");
    await expect(page.locator("#tp-pay")).toContainText("$297.00");
  });

  test("staff: the bill still shows when the bill read lands first and the paid list lands second", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await openPortal(page, OWNER, { dashboard: STAFF_FILE, summary: BILL, dashboardHold: held });
    await expect(link(page)).toHaveCount(2);
    release();
    await expect(page.locator("#tp-pay")).toContainText("Roadmap");
    await expect(link(page)).toHaveCount(2);
    await expect(link(page).nth(1)).toHaveAttribute("href", "https://pay.example.test/inv-2002");
  });

  test("staff: the bill still shows when the paid list lands first and the bill read lands second", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await openPortal(page, OWNER, { dashboard: STAFF_FILE, summary: BILL, summaryHold: held });
    await expect(page.locator("#tp-pay")).toContainText("Roadmap");
    release();
    await expect(link(page)).toHaveCount(2);
    await expect(link(page).nth(0)).toHaveAttribute("href", "https://pay.example.test/inv-2001");
  });

  test("staff: an invoice with no pay address shows its amount and no link, and a bad address is never a link", async ({ page }) => {
    await openPortal(page, OWNER, {
      dashboard: STAFF_FILE,
      summary: { invoice_due: { count: 2, items: [
        { kind: "Setup", reference: "INV-1", amount_display: "$497.00", pay_url: null },
        { kind: "Fee", reference: "INV-2", amount_display: "$100.00", pay_url: "javascript:alert(1)" },
      ] } },
    });
    await expect(page.locator("#tp-pay")).toContainText("$497.00");
    await expect(page.locator("#tp-pay")).toContainText("$100.00");
    await expect(link(page)).toHaveCount(0);
  });
});

const SHARE_URL = "https://fundhub.ai/start?ref=FH1042";
const ENROLLED = {
  ok: true, enrolled: true,
  affiliate: { id: "aff-1", name: "Dana Whitfield", code: "FH1042", shareUrl: SHARE_URL, status: "active", tierLevel: "tier1", balanceDue: null },
  rates: { direct: { percent: 20 }, downline: { percent: 5 } }, referrals: [], payouts: [], gates: null,
};

test.describe("client portal: Refer a friend, Copy", () => {
  test("Copy puts the exact share link on the clipboard and says Copied, then goes back to Copy", async ({ page }) => {
    await openPortal(page, CLIENT, {
      affiliate: ENROLLED,
      init: () => {
        window.__copied = [];
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } },
        });
      },
    });
    await expect(page.locator("#ref-url")).toHaveText(SHARE_URL);
    await page.locator("#ref-copy").click();
    await expect(page.locator("#ref-copy")).toHaveText("Copied");
    expect(await page.evaluate(() => window.__copied)).toEqual([SHARE_URL]);
    await expect(page.locator("#ref-copy")).toHaveText("Copy", { timeout: 5000 });
  });

  test("with no clipboard on the browser, Copy selects the link and says Press copy", async ({ page }) => {
    await openPortal(page, CLIENT, {
      affiliate: ENROLLED,
      init: () => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); },
    });
    await expect(page.locator("#ref-url")).toHaveText(SHARE_URL);
    await page.locator("#ref-copy").click();
    await expect(page.locator("#ref-copy")).toHaveText("Press copy");
    expect(await page.evaluate(() => String(window.getSelection()))).toBe(SHARE_URL);
  });

  test("a clipboard that refuses falls back to selecting the link", async ({ page }) => {
    await openPortal(page, CLIENT, {
      affiliate: ENROLLED,
      init: () => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error("denied")) },
        });
      },
    });
    await page.locator("#ref-copy").click();
    await expect(page.locator("#ref-copy")).toHaveText("Press copy");
  });

  test("before they have joined there is no link to copy and the Copy button is not shown", async ({ page }) => {
    await openPortal(page, CLIENT);
    await expect(page.locator("#ref-have")).toBeHidden();
    await expect(page.locator("#ref-copy")).toBeHidden();
  });
});
