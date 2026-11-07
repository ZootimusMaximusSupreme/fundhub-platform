// Finance OS → Applications: the application and approval tracker card
// (public/app/money-applications.js, wave 3 unit O). Every /api/** call is
// answered by the page, so nothing reaches a server, a bank or a database.
// One sample person: a Chase business card Fundhub tracked and approved (already
// on the accounts), a Bank of America card waiting on papers, an older Chase
// approval from before the tracker shipped (not on the accounts yet), and a
// credit union loan the client added. Clicked like a person at 1440, 390 and 320
// wide: add an application, change a status, add an approval to the accounts,
// the four states, every control at least 44 by 44, and no sideways scroll.
import { test, expect } from "@playwright/test";
import fs from "node:fs";

const DIR = "ops/workflows/build-evidence/finance-os-applications-2026-11-07";
fs.mkdirSync(DIR, { recursive: true });

const row = (over) => ({
  source: "fundhub", product: null, kind: "card", kind_words: "Credit card", owner_kind: "business", requested_cents: null,
  approved_cents: null, decided_on: null, last4: null, counts: true, logo_url: null, account: null, account_state: null,
  account_words: null, can_add_account: false, can_edit: false, ...over
});
const ROWS = [
  row({ id: "e0000000-0000-4000-8000-000000000001", source: "self", bank: "Desert Credit Union", kind: "loan", kind_words: "Loan", owner_kind: "personal",
    applied_on: "2026-11-02", requested_cents: 2000000, status: "approved", status_words: "Approved", approved_cents: 2000000, decided_on: "2026-11-05",
    account_state: "loan", account_words: "Add the loan on your Accounts page once the money lands.", can_edit: true }),
  row({ id: "c0000000-0000-4000-8000-000000000013", bank: "Bank of America", product: "Business Advantage", applied_on: "2026-10-20", status: "pending",
    status_words: "Pending", logo_url: "/assets/lenders/bank-of-america.png" }),
  row({ id: "c0000000-0000-4000-8000-000000000011", bank: "Chase", product: "Ink Business Cash", applied_on: "2026-10-01", requested_cents: 1500000,
    status: "approved", status_words: "Approved", approved_cents: 1000000, decided_on: "2026-10-08", logo_url: "/assets/lenders/chase.png",
    account: { id: "acct-1", name: "Chase Ink Business Cash", mask: null, provider: "manual" }, account_state: "added",
    account_words: "On your accounts. The balance shows once your bank connection sees it." }),
  row({ id: "c0000000-0000-4000-8000-000000000009", bank: "Chase", product: "Ink Business Unlimited", applied_on: "2026-06-03", status: "approved",
    status_words: "Approved", approved_cents: 500000, logo_url: "/assets/lenders/chase.png", account_state: "missing",
    account_words: "Not on your accounts yet.", can_add_account: true })
];
const counts = (rows) => {
  const n = { total: rows.length, planned: 0, applied: 0, pending: 0, approved: 0, denied: 0 };
  for (const r of rows) n[r.status] += 1;
  return n;
};
const tracker = (rows = ROWS) => ({ ok: true, rows, counts: counts(rows), can_add: true });
const view = (t) => ({ ok: true, view: { client: { id: "c1", name: "Alex Sample" }, eligible: false, can_paste: false, applications: [], declines: [], tracker: t } });

async function open(page, { state = "full", width }) {
  const posts = [];
  const ctl = { state, release: null };
  const held = new Promise((r) => { ctl.release = r; });
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { localStorage.setItem("fh_token", "e2e-token"); localStorage.setItem("fh_role", "client"); });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/auth/session") return reply({ ok: true, principal: "client" });
    if (url.pathname === "/api/blueprint/declines") {
      if (method === "POST") {
        const body = route.request().postDataJSON();
        posts.push(body);
        if (body.action === "track_add") {
          const added = row({ id: "e0000000-0000-4000-8000-000000000099", source: "self", bank: body.bank, product: body.product || null, kind: body.kind,
            applied_on: body.applied_on, status: body.status, status_words: body.status === "approved" ? "Approved" : "Applied",
            approved_cents: body.approved_amount ? Number(body.approved_amount) * 100 : null, account_state: "added",
            account_words: "On your accounts. The balance shows once your bank connection sees it.", can_edit: true });
          return reply({ ok: true, action: body.action, id: added.id, account: { status: "added" }, tracker: tracker([added, ...ROWS]) }, 201);
        }
        if (body.action === "track_update") {
          const rows = ROWS.map((r) => (r.id === body.id ? { ...r, status: body.status, status_words: "Denied", approved_cents: null, account_state: null, account_words: null } : r));
          return reply({ ok: true, action: body.action, id: body.id, account: { status: "not_needed" }, tracker: tracker(rows) });
        }
        const rows = ROWS.map((r) => (r.id === body.id ? { ...r, account_state: "added", account_words: "On your accounts. The balance shows once your bank connection sees it.", can_add_account: false } : r));
        return reply({ ok: true, action: body.action, id: body.id, account: { status: "added" }, tracker: tracker(rows) });
      }
      if (ctl.state === "loading") await held;
      if (ctl.state === "error") return reply(view({ ok: false, error: "tracker_unavailable" }));
      if (ctl.state === "down") return reply({ ok: false, db: "down" }, 503);
      if (ctl.state === "notracker") {
        // The sample demo answers this read with no tracker at all.
        const { tracker: _none, ...noTracker } = view(null).view;
        return reply({ ok: true, view: noTracker });
      }
      return reply(view(ctl.state === "empty" ? tracker([]) : tracker()));
    }
    if (url.pathname === "/api/money/overview") return reply({ ok: true, client: { name: "Alex Sample" }, sandbox: false });
    if (url.pathname === "/api/read/affiliate-portal") return reply({ ok: true, enrolled: false });
    return reply({ ok: true, items: [] });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/app/financeos.html#declines");
  return { posts, ctl, errors };
}

const card = (page) => page.locator("#fos-declines .fh-apps");
const rowOf = (page, id) => card(page).locator(`.fa-row[data-fa-id="${id}"]`);

async function noSideScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
/* Every visible control in the card is at least 44 by 44. */
async function bigTargets(page) {
  const small = await card(page).evaluate((el) => [...el.querySelectorAll("button,input,select,a")]
    .filter((c) => c.offsetParent !== null)
    .map((c) => { const r = c.getBoundingClientRect(); return { t: (c.textContent || c.id || c.name).trim().slice(0, 30), w: r.width, h: r.height }; })
    .filter((c) => c.w < 44 || c.h < 44));
  expect(small).toEqual([]);
}

for (const width of [1440, 390, 320]) {
  test(`applications card: full list, add, change status, add to accounts at ${width}`, async ({ page }) => {
    const { posts, errors } = await open(page, { width });
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator("h2")).toHaveText("Your bank applications");
    await expect(card(page).locator(".fa-head .fa-cap")).toHaveText("3 of 4 approved. 1 pending.");
    const ink = rowOf(page, "c0000000-0000-4000-8000-000000000011");
    await expect(ink.locator(".fa-logo img")).toHaveAttribute("src", "/assets/lenders/chase.png");
    expect(await ink.locator(".fa-logo img").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(ink.locator(".fa-chip")).toHaveText("✓Approved");
    await expect(ink.locator(".fa-amt")).toHaveText("$10,000");
    await expect(ink.locator(".fa-facts")).toHaveText("Applied Oct 1, 2026 · Asked $15,000 · Approved Oct 8, 2026 · Fundhub is tracking this one");
    await expect(ink.locator(".fa-acct")).toHaveText("On your accounts. The balance shows once your bank connection sees it.");
    await expect(rowOf(page, "e0000000-0000-4000-8000-000000000001").locator(".fa-logo")).toHaveCount(0);
    // Before the list: the title, then one short line (QA15, short client words).
    await expect(page.locator("#fos-declines .dc-head .caption")).toHaveCount(0);
    await expect(page.locator("#fos-declines .dc-locked")).toHaveText("Decline help comes with the Capital Blueprint.");
    await noSideScroll(page);
    await bigTargets(page);
    await page.screenshot({ path: `${DIR}/applications-full-${width}.png`, fullPage: true });

    // Add an application, like a person: open, type, pick Approved, then the approval fields show.
    await card(page).getByRole("button", { name: "Add an application" }).click();
    const form = card(page).locator("#fa-add");
    await expect(form).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Add an application" })).toHaveAttribute("aria-expanded", "true");
    await expect(form.locator('[data-fa-when="approved"]')).toBeHidden();
    await form.getByLabel("Bank", { exact: true }).fill("American Express");
    await form.getByLabel("Card or loan name").fill("Blue Business Plus");
    await form.getByLabel("What you applied for").selectOption("card");
    await form.getByLabel("Who it is for").selectOption("business");
    await form.getByLabel("Day you applied").fill("2026-11-01");
    await form.getByLabel("Where it stands").selectOption("approved");
    await expect(form.locator('[data-fa-when="approved"]')).toBeVisible();
    await form.getByLabel("Approved limit or amount").fill("7500");
    await form.getByLabel("Last 4 digits of the card").fill("1005");
    await form.getByLabel("Day the bank answered").fill("2026-11-04");
    await bigTargets(page);
    await noSideScroll(page);
    await page.screenshot({ path: `${DIR}/applications-add-form-${width}.png`, fullPage: true });
    await form.getByRole("button", { name: "Save application" }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({
      action: "track_add", bank: "American Express", product: "Blue Business Plus", kind: "card", owner_kind: "business",
      applied_on: "2026-11-01", requested_amount: "", status: "approved", approved_amount: "7500", last4: "1005", decided_on: "2026-11-04"
    });
    await expect(card(page).locator(".fa-flash")).toHaveText("Saved. It is on your accounts now. The balance shows once your bank connection sees it.");
    await expect(card(page).locator(".fa-row").first()).toContainText("American Express");

    // Change status on the client's own row: Denied hides the limit and keeps the answer day.
    const loanRow = rowOf(page, "e0000000-0000-4000-8000-000000000001");
    await loanRow.getByRole("button", { name: "Change status" }).click();
    const edit = loanRow.locator("form[data-fa-form=edit]");
    await expect(edit).toBeVisible();
    await edit.getByLabel("Where it stands").selectOption("denied");
    await expect(edit.locator('[data-fa-when="approved"]')).toBeHidden();
    await expect(edit.locator('[data-fa-when="answered"]')).toBeVisible();
    await edit.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]).toEqual({ action: "track_update", id: "e0000000-0000-4000-8000-000000000001", status: "denied", decided_on: "2026-11-05" });
    await expect(rowOf(page, "e0000000-0000-4000-8000-000000000001").locator(".fa-chip")).toHaveText("✗Denied");

    // An approval from before the tracker: one tap puts it on the accounts.
    const old = rowOf(page, "c0000000-0000-4000-8000-000000000009");
    await expect(old.locator(".fa-acct")).toHaveText("Not on your accounts yet.");
    await old.getByRole("button", { name: "Add to my accounts" }).click();
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]).toEqual({ action: "track_add_account", source: "fundhub", id: "c0000000-0000-4000-8000-000000000009" });
    await expect(rowOf(page, "c0000000-0000-4000-8000-000000000009").getByRole("button", { name: "Add to my accounts" })).toHaveCount(0);
    await expect(rowOf(page, "c0000000-0000-4000-8000-000000000011").getByRole("button", { name: "Change status" })).toHaveCount(0);
    await noSideScroll(page);
    expect(errors).toEqual([]);
  });

  test(`applications card: empty, error with a working retry, and loading at ${width}`, async ({ page }) => {
    const { ctl, errors } = await open(page, { width, state: "empty" });
    await expect(card(page).locator(".fa-empty")).toHaveText("No bank applications yet.");
    await expect(card(page).getByRole("button", { name: "Add an application" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${DIR}/applications-empty-${width}.png`, fullPage: true });

    ctl.state = "error";
    await page.reload();
    await expect(card(page)).toHaveAttribute("role", "alert");
    await expect(card(page)).toContainText("We could not load your applications.");
    await bigTargets(page);
    await page.screenshot({ path: `${DIR}/applications-error-${width}.png`, fullPage: true });
    ctl.state = "full";
    await card(page).getByRole("button", { name: "Try again" }).click();
    await expect(card(page).locator(".fa-row")).toHaveCount(4);

    ctl.state = "loading";
    await page.reload();
    await expect(page.locator("#fos-declines [aria-busy=true]").first()).toBeVisible();
    await page.screenshot({ path: `${DIR}/applications-loading-${width}.png`, fullPage: true });
    ctl.release();
    await expect(card(page).locator(".fa-row")).toHaveCount(4);
    expect(errors).toEqual([]);
  });
}

test("the card mounts on its own, the way the Blueprint funding area uses it", async ({ page }) => {
  const { errors } = await open(page, { width: 390 });
  await expect(card(page)).toBeVisible();
  const rows = await page.evaluate(async () => {
    const el = document.createElement("div");
    el.id = "bp-apps";
    document.body.appendChild(el);
    window.FHApplications.mount(el, {});
    for (let i = 0; i < 50 && !el.querySelector(".fa-row:not(.fa-skel)"); i++) await new Promise((r) => setTimeout(r, 50));
    return el.querySelectorAll(".fa-row:not(.fa-skel)").length;
  });
  expect(rows).toBe(4);
  expect(errors).toEqual([]);
});

test("a read with no tracker (the sample demo's): no error card anywhere, and the card on its own paints nothing", async ({ page }) => {
  const { errors } = await open(page, { width: 390, state: "notracker" });
  await expect(page.locator("#fos-declines h1")).toHaveText("Your applications");
  await expect(page.locator("#fos-declines [role=alert]")).toHaveCount(0);
  const html = await page.evaluate(async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    window.FHApplications.mount(el, {});
    for (let i = 0; i < 50 && el.querySelector("[aria-busy]"); i++) await new Promise((r) => setTimeout(r, 50));
    return el.innerHTML;
  });
  expect(html).toBe("");
  expect(errors).toEqual([]);
});
