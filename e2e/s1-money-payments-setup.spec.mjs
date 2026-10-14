// Slice 1 (money screens): the staff payment-plan controls and the setup steps,
// pressed for real. Each test presses one control against fake API answers and
// checks the exact request body it sends, and the words it paints afterwards.
// Nothing leaves the browser: every /api/** call is answered by page.route(),
// and the checkout address a button goes to is answered with a plain page.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { json, withSession } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAYMENTS = JSON.parse(fs.readFileSync(path.resolve(HERE, "../src/http/fixtures/money-payments.sample.json"), "utf8"));
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const PLAN = PAYMENTS.plans[0];
const CHECKOUT = "https://pay.example.test/checkout/setup-1";
const APPROVE = "https://pay.example.test/approve/soft-pull-1";

async function answerExternal(page) {
  await page.route("https://pay.example.test/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>pay</title>" }));
}

// ── payments ───────────────────────────────────────────────────────────────
const PAGES = [
  ["the standalone page", `/app/money-payments.html?client_id=${CLIENT}`, "/app/money-payments.html"],
  ["the FinanceOS Payments tab", `/app/financeos.html?client_id=${CLIENT}#payments`, "/app/financeos.html#payments"],
];

async function openPayments(page, url, { settleAnswer = { ok: true }, client = false } = {}) {
  await withSession(page, { staff: { role: client ? "client" : "owner" } });
  const posts = [];
  await page.route("**/api/**", (route) => json(route, { ok: true }));
  await page.route("**/api/money/overview**", (route) => json(route, { ok: true, client: { name: "Sample Client" }, sandbox: false }));
  await page.route("**/api/money/payments**", async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      return json(route, settleAnswer);
    }
    return json(route, PAYMENTS);
  });
  await page.goto(url);
  // A client's page has no staff form to wait for: wait for the plan card.
  await expect(page.locator(client ? ".fh-payments .plan" : ".fh-payments .addplan").first()).toBeVisible();
  return posts;
}

for (const [where, url, clientUrl] of PAGES) {
  test.describe(`Payments, staff controls on ${where}`, () => {
    test("a client's own page shows the plan and none of the staff controls", async ({ page }) => {
      const posts = await openPayments(page, clientUrl, { client: true });
      await expect(page.locator(`.fh-payments .plan[data-plan="${PLAN.id}"]`)).toBeVisible();
      await expect(page.locator(".fh-payments .addplan")).toHaveCount(0);
      await expect(page.locator('.fh-payments form[data-form="add"]')).toHaveCount(0);
      await expect(page.locator('.fh-payments form[data-form="record"]')).toHaveCount(0);
      await expect(page.locator('.fh-payments [data-act="settle"]')).toHaveCount(0);
      await expect(page.locator(".fh-payments .staff")).toHaveCount(0);
      expect(posts).toEqual([]);
    });

    test("Add a payment plan sends the kind, who it is owed to, the name and the dated schedule in cents", async ({ page }) => {
      const posts = await openPayments(page, url);
      const form = page.locator('.fh-payments form[data-form="add"]');
      await form.locator('select[name="kind"]').selectOption("bnpl");
      // The box opens on "Fundhub LLC": type something else so a box the page ignores shows.
      await form.locator('input[name="owed_to"]').fill("Clarity Partners Inc");
      await form.locator('input[name="label"]').fill("Funding program balance");
      await form.locator('textarea[name="schedule"]').fill("2026-11-01, 500.00\n2026-12-01, 250.50");
      await form.locator('button[type="submit"]').click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]).toEqual({
        action: "add_plan", kind: "bnpl", owed_to: "Clarity Partners Inc", label: "Funding program balance",
        installments: [{ due_on: "2026-11-01", amount_cents: 50000 }, { due_on: "2026-12-01", amount_cents: 25050 }],
        client_id: CLIENT,
      });
      // The section re-reads after a save, so the typed schedule is cleared.
      await expect(page.locator('.fh-payments form[data-form="add"] textarea[name="schedule"]')).toHaveValue("");
    });

    test("Add a payment plan with a bad line says which line and sends nothing", async ({ page }) => {
      const posts = await openPayments(page, url);
      const form = page.locator('.fh-payments form[data-form="add"]');
      await form.locator('textarea[name="schedule"]').fill("2026-11-01, 500.00\nnext month, 100");
      await form.locator('button[type="submit"]').click();
      await expect(page.locator(".fh-payments .addplan .act-msg")).toContainText("Line 2 needs a date and an amount");
      expect(posts).toEqual([]);
    });

    test("Record payment sends the plan and the amount as cents, then re-reads the plan", async ({ page }) => {
      const posts = await openPayments(page, url);
      const form = page.locator(`.fh-payments form[data-form="record"][data-plan="${PLAN.id}"]`);
      await form.locator('input[name="amount"]').fill("$500.00");
      await form.locator('button[type="submit"]').click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]).toEqual({ action: "record_payment", plan_id: PLAN.id, amount_cents: 50000, client_id: CLIENT });
    });

    test("Record payment with no amount says so and sends nothing", async ({ page }) => {
      const posts = await openPayments(page, url);
      const form = page.locator(`.fh-payments form[data-form="record"][data-plan="${PLAN.id}"]`);
      await form.locator('input[name="amount"]').fill("five hundred");
      await form.locator('button[type="submit"]').click();
      await expect(form.locator("xpath=..").locator(".act-msg")).toHaveText("Type the amount received, like 500.00");
      expect(posts).toEqual([]);
    });

    test("Mark settled asks first: Yes sends mark_settled for that plan, No sends nothing", async ({ page }) => {
      const posts = await openPayments(page, url);
      const settle = page.locator(`.fh-payments [data-act="settle"][data-plan="${PLAN.id}"]`);
      const asked = [];
      page.once("dialog", (dialog) => { asked.push(dialog.message()); dialog.dismiss(); });
      await settle.click();
      await expect.poll(() => asked.length).toBe(1);
      expect(asked[0]).toMatch(/^Mark .* as settled\? The money helper will stop all reminders for it\.$/);
      expect(posts).toEqual([]);

      page.once("dialog", (dialog) => dialog.accept());
      await settle.click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]).toEqual({ action: "mark_settled", plan_id: PLAN.id, client_id: CLIENT });
    });

    test("a refused record shows the server's words and gives the button back", async ({ page }) => {
      const posts = await openPayments(page, url, { settleAnswer: { ok: false, error: "plan_not_open", message: "That plan is already closed." } });
      const form = page.locator(`.fh-payments form[data-form="record"][data-plan="${PLAN.id}"]`);
      await form.locator('input[name="amount"]').fill("500");
      const submit = form.locator('button[type="submit"]');
      await submit.click();
      await expect.poll(() => posts.length).toBe(1);
      await expect(submit).toHaveText("Record payment");
      await expect(submit).toBeEnabled();
    });
  });
}

// ── setup ──────────────────────────────────────────────────────────────────
function setupBody(over = {}) {
  return {
    ok: true,
    client: { id: CLIENT, name: "Ada Lane" },
    paid: false, paid_at: null,
    setup_fee_cents: 49700, price_per_container_cents: 9900, containers: 0, monthly_cents: null, open_checkout: null,
    soft_pull: { requested: false, completed: false, last_pulled_at: null, price: { base_cents: 3200, business_addon_cents: 1000 } },
    entitled: false,
    steps: [
      { key: "pay", label: "Pay setup fee", done: false },
      { key: "soft_pull", label: "Run your soft pull", done: false },
      { key: "accounts", label: "Add your businesses and accounts", done: false },
      { key: "live", label: "You're live", done: false },
    ],
    current_step: "pay",
    ...over,
  };
}

async function openSetup(page, url, body, answer) {
  await withSession(page, { staff: { role: "owner" } });
  await answerExternal(page);
  const posts = [];
  await page.route("**/api/**", (route) => json(route, { ok: true }));
  await page.route("**/api/money/overview**", (route) => json(route, { ok: true, client: { name: "Ada Lane" }, sandbox: false }));
  await page.route("**/api/money/setup**", async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      return json(route, answer ?? { ok: true });
    }
    return json(route, body);
  });
  await page.goto(url);
  return posts;
}

const SETUP_PAGES = [
  ["the standalone page", `/app/money-setup.html?client_id=${CLIENT}`],
  ["the FinanceOS Setup tab", `/app/financeos.html?client_id=${CLIENT}#setup`],
];

for (const [where, url] of SETUP_PAGES) {
  test.describe(`Setup steps on ${where}`, () => {
    test("Pay $497.00 setup asks for the hosted checkout and goes to the link it is given", async ({ page }) => {
      const posts = await openSetup(page, url, setupBody(), { ok: true, checkout_url: CHECKOUT });
      const pay = page.getByRole("button", { name: "Pay $497.00 setup" });
      await expect(pay).toBeVisible();
      await pay.click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]).toEqual({ action: "start_checkout", client_id: CLIENT });
      await page.waitForURL(CHECKOUT);
    });

    test("no price set means no pay button, only the words", async ({ page }) => {
      await openSetup(page, url, setupBody({ setup_fee_cents: null }));
      await expect(page.getByText("The setup price is not set yet")).toBeVisible();
      await expect(page.locator('[data-act="checkout"]')).toHaveCount(0);
    });

    test("a refused checkout says nothing was charged and gives the button back", async ({ page }) => {
      await openSetup(page, url, setupBody(), { ok: false, error: "price_not_set" });
      const pay = page.getByRole("button", { name: "Pay $497.00 setup" });
      await pay.click();
      await expect(page.getByText("Nothing was charged")).toBeVisible();
      await expect(pay).toBeEnabled();
    });
  });
}

test.describe("Setup steps on the standalone page", () => {
  const url = `/app/money-setup.html?client_id=${CLIENT}`;

  test("a checkout already started shows Finish paying with that exact link and its amount", async ({ page }) => {
    await openSetup(page, url, setupBody({ open_checkout: { url: CHECKOUT, amount_cents: 49700 } }));
    const link = page.getByRole("link", { name: "Finish paying" });
    await expect(link).toHaveAttribute("href", CHECKOUT);
    await expect(page.getByText("You started a checkout for $497.00")).toBeVisible();
    await expect(page.locator('[data-act="checkout"]')).toHaveCount(0);
  });

  test("Run soft pull asks for the approval form and goes to the link it is given", async ({ page }) => {
    const paid = setupBody({
      paid: true, paid_at: "2026-10-01T12:00:00Z", current_step: "soft_pull",
      steps: [
        { key: "pay", label: "Pay setup fee", done: true },
        { key: "soft_pull", label: "Run your soft pull", done: false },
        { key: "accounts", label: "Add your businesses and accounts", done: false },
        { key: "live", label: "You're live", done: false },
      ],
    });
    const posts = await openSetup(page, url, paid, { ok: true, approve_url: APPROVE });
    await expect(page.getByText("The form costs $32.00, plus $10.00 for each business you add.")).toBeVisible();
    await page.locator('[data-act="soft-pull"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ action: "request_soft_pull", client_id: CLIENT });
    await page.waitForURL(APPROVE);
  });
});
