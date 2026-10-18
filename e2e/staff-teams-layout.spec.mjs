import { test, expect } from "@playwright/test";
import { wireApi, gotoScreen, OWNER, EMPTY_PAGE, trackErrors } from "./harness.mjs";

// All APIs and all writes are intercepted. These are fixture proofs, never live staff proof.
const SESSION = { ...OWNER, principal: "staff" };
const SELF = { ...OWNER.staff, monitoring_consent_at: null, open_shift: 0, notify_booked_call_sms: false };
const OTHER = { id: "staff-2", name: "Casey Reed", email: "casey@fundhub.ai", role: "closer",
  status: "invited", monitoring_consent_at: null, open_shift: 0, notify_booked_call_sms: false };
const roster = (items) => ({ ...EMPTY_PAGE, count: items.length, items, hiddenCount: 2 });

async function open(page, options = {}) {
  const writes = [];
  const errors = trackErrors(page);
  await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
  await wireApi(page, { session: options.session || SESSION, handlers: {
    "/api/read/staff": options.staff || (() => roster(options.items || [SELF, OTHER])),
    "/api/read/contracts": options.contracts || (() => EMPTY_PAGE),
    "/api/staff/telemetry": options.telemetry || (() => ({ ok: true, staff: { monitoring_on: false },
      hours: { payable_hours: 0 }, activity: { avg_overall: null, activity_samples: 0,
        screenshot_samples: 0, recent: [] }, shifts: [] }))
  } });
  await page.route("**/api/**", async route => {
    const request = route.request();
    if (["GET", "HEAD"].includes(request.method())) return route.fallback();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    writes.push({ path, body });
    // No write ever reaches a server; unexpected writes are an explicit refusal.
    const data = options.write ? options.write(path, body) : { ok: false, error: "fixture_write_refused" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await gotoScreen(page, "staff-teams.html", "", options.session || SESSION);
  return { writes, errors };
}

for (const width of [1440, 390, 320]) {
  test.describe("Staff Teams at " + width, () => {
    test.use({ viewport: { width, height: 900 } });
    test("full roster stays usable, filters real rows and opens editor by keyboard", async ({ page }) => {
      const { writes, errors } = await open(page);
      await expect(page.locator("#kHead")).toHaveText("2");
      await expect(page.locator("#teamLoadState")).toBeHidden();
      await expect(page.getByRole("button", { name: "Edit Casey Reed", exact: true })).toBeVisible();
      await page.getByLabel("Search staff by name, email or code").fill("casey@");
      await expect(page.locator("#rosterBody tr[data-id]")).toHaveCount(1);
      await page.getByLabel("Filter staff by role").selectOption("Closer");
      const edit = page.getByRole("button", { name: "Edit Casey Reed", exact: true });
      await edit.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByLabel("First name", { exact: true })).toBeFocused();
      await expect(page.locator("#edAgreements")).toHaveText("None on file yet.");
      await page.keyboard.press("Escape");
      await expect(page.locator("#editor")).toHaveAttribute("inert", "");
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
    test("empty roster shows zero headcount and keeps Add person available", async ({ page }) => {
      const { writes } = await open(page, { items: [] });
      await expect(page.locator("#teamLoadState")).toBeHidden();
      await expect(page.locator("#kHead")).toHaveText("0");
      await expect(page.locator("#kShift")).toHaveText("—");
      await expect(page.locator("#hiddenLine")).toContainText("2 people");
      await page.locator("#addBtn").click();
      await expect(page.locator("#edTitle")).toHaveText("New person");
      await expect(page.locator("#ed_phone")).toHaveAttribute("readonly", "");
      await expect(page.locator("#edReset")).toBeHidden();
      await expect(page.locator("#edDeact")).toBeHidden();
      await page.locator("#edCancel").click();
      expect(writes).toEqual([]);
    });
    test("loading has a clear state without sample staff", async ({ page }) => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await open(page, { staff: async () => { await gate; return roster([SELF]); } });
      try {
        await expect(page.locator("#teamLoadState")).toHaveText("Loading team members…");
        await expect(page.locator("#rosterBody tr[data-id]")).toHaveCount(0);
      } finally { release(); }
      await expect(page.locator("#kHead")).toHaveText("1");
      await expect(page.locator("#teamLoadState")).toBeHidden();
    });
    test("roster failure keeps error visible and does not invent people", async ({ page }) => {
      await open(page, { staff: async route => {
        await route.fulfill({ status: 503, contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "fixture_unavailable" }) });
      } });
      await expect(page.locator("#teamLoadState")).toContainText("could not be loaded");
      await expect(page.locator("#fh-data-banner")).toBeVisible();
      await expect(page.locator("#rosterBody tr[data-id]")).toHaveCount(0);
    });
    test("tabs work by keyboard and telemetry distinguishes zero from unknown", async ({ page }) => {
      await open(page);
      await expect(page.locator("#kHead")).toHaveText("2");
      await page.getByRole("tab", { name: "Roster", exact: true }).focus();
      await page.keyboard.press("End");
      await expect(page.getByRole("tab", { name: "Telemetry", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByLabel("Person for shift and activity details").selectOption("staff-2");
      await expect(page.locator("#teleHours")).toHaveText("0h");
      await expect(page.locator("#teleAvg")).toHaveText("—");
      await expect(page.locator("#teleShifts")).toContainText("No shifts on file.");
      await expect(page.locator("#teleEvents")).toContainText("No monitor events yet.");
      await expect(page.locator("#teleRefresh")).toBeVisible();
    });
  });
}

test("permission information does not claim an editable permission matrix", async ({ page }) => {
  await open(page);
  await page.locator("#toAdvanced").click();
  await expect(page.locator("#tab-perms")).toBeVisible();
  await expect(page.locator("#tab-perms")).toContainText("enforced by the server");
  await expect(page.locator("#tab-perms input")).toHaveCount(0);
});

test("self clock and owner consent retain exact mocked write contracts", async ({ page }) => {
  const { writes } = await open(page, { write: (path, body) => {
    if (path === "/api/shifts") return { ok: true, shift: { id: "fixture-shift" } };
    if (path === "/api/staff/monitoring-consent") return { ok: true,
      staff: { monitoring_on: body.action === "grant", monitoring_consent_at: "2026-10-18T00:00:00Z" } };
    return { ok: false, error: "unexpected_write" };
  } });
  await expect(page.locator("#kHead")).toHaveText("2");
  await page.getByRole("tab", { name: "Clock & consent", exact: true }).click();
  await expect(page.locator("[data-clock]")).toHaveCount(1);
  await page.locator('[data-clock="staff-1"]').click();
  await expect.poll(() => writes).toContainEqual({ path: "/api/shifts", body: { action: "clock_in" } });
  page.once("dialog", dialog => dialog.accept());
  await page.locator('[data-consent="staff-2"]').click();
  await expect.poll(() => writes).toContainEqual({ path: "/api/staff/monitoring-consent",
    body: { staff_id: "staff-2", action: "grant" } });
});

test("non-owner receives no owner consent controls and can only clock own row", async ({ page }) => {
  const session = { ok: true, principal: "staff", staff: { ...OTHER, status: "active" } };
  await open(page, { session });
  await expect(page.locator("#kHead")).toHaveText("2");
  await page.getByRole("tab", { name: "Clock & consent", exact: true }).click();
  await expect(page.locator("[data-consent]")).toHaveCount(0);
  await expect(page.locator("[data-clock]")).toHaveCount(1);
  await expect(page.locator("[data-clock]")).toHaveAttribute("data-clock", "staff-2");
});

test("profile, SMS choice and role changes retain exact fields", async ({ page }) => {
  const { writes } = await open(page, { write: () => ({ ok: true }) });
  await page.getByRole("button", { name: "Edit Casey Reed", exact: true }).click();
  await page.getByLabel("Phone", { exact: true }).fill("+15550102000");
  await page.getByRole("switch", { name: "Text when a call is booked", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#ed_booked_sms")).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Role", { exact: true }).selectOption("Setter");
  await page.locator("#edSave").click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[0]).toEqual({ path: "/api/auth/staff-update", body: {
    staff_id: "staff-2", name: "Casey Reed", email: "casey@fundhub.ai",
    phone: "+15550102000", start_date: "", notify_booked_call_sms: true } });
  expect(writes[1]).toEqual({ path: "/api/auth/staff-role", body: { staff_id: "staff-2", role: "setter" } });
});

test("invite remains explicit and includes the notification inbox", async ({ page }) => {
  const { writes } = await open(page, { write: () => ({ ok: false, error: "fixture_refused" }) });
  await page.locator("#addBtn").click();
  await page.getByLabel("First name", { exact: true }).fill("Morgan");
  await page.getByLabel("Last name", { exact: true }).fill("Lee");
  await page.getByLabel("Email", { exact: true }).fill("morgan@example.test");
  await page.getByLabel("Role", { exact: true }).selectOption("Closer");
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#edSave").click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ path: "/api/auth/invite", body: {
    name: "Morgan Lee", role: "closer", notify_email: "morgan@example.test" } });
  await expect(page.locator("#edSave")).toBeEnabled();
});

test("password reset and revoke require confirmation and surface refusal", async ({ page }) => {
  const { writes } = await open(page);
  await page.getByRole("button", { name: "Edit Casey Reed", exact: true }).click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("#edReset").click();
  expect(writes).toEqual([]);
  page.on("dialog", dialog => dialog.accept());
  await page.locator("#edReset").click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ path: "/api/auth/admin-reset", body: { email: "casey@fundhub.ai" } });
  await expect(page.locator("#edReset")).toBeEnabled();
  await page.locator("#edDeact").click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual({ path: "/api/auth/suspend", body: { staff_id: "staff-2" } });
});

test("signed agreement download retains signed file selection", async ({ page }) => {
  const reads = [];
  await open(page, { contracts: (route, { url }) => {
    const query = new URL(url).searchParams;
    reads.push(Object.fromEntries(query));
    if (query.get("file") === "contract") return { ok: true, filename: "fixture-agreement.pdf",
      pdf_base64: "JVBERi0xLjQKJSVFT0Y=" };
    return roster([{ id: "agreement-1", title: "Fixture employment agreement", status: "signed",
      signed_document_id: "document-1", signed_at: "2026-10-18T00:00:00Z" }]);
  } });
  await page.getByRole("button", { name: "Edit Casey Reed", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Open signed", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("fixture-agreement.pdf");
  expect(reads.some(query => query.staff_id === "staff-2")).toBe(true);
  expect(reads.some(query => query.id === "agreement-1" && query.signed === "1")).toBe(true);
});

test("telemetry failure gives a local error and leaves refresh available", async ({ page }) => {
  await open(page, { telemetry: () => ({ ok: false, error: "fixture_telemetry_refused" }) });
  await expect(page.locator("#kHead")).toHaveText("2");
  await page.getByRole("tab", { name: "Telemetry", exact: true }).click();
  await page.locator("#teleStaff").selectOption("staff-2");
  await expect(page.locator("#teleEmpty")).toContainText("fixture_telemetry_refused");
  await expect(page.locator("#teleBody")).toBeHidden();
  await expect(page.locator("#teleRefresh")).toBeVisible();
});

test.describe("Staff Teams touch controls", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("touch can open and close editor and reach secondary work", async ({ page }) => {
    const { writes } = await open(page);
    await expect(page.locator("#teamLoadState")).toBeHidden();
    await page.locator("#addBtn").tap();
    await expect(page.locator("#edTitle")).toHaveText("New person");
    await page.locator("#edClose").tap();
    await page.getByRole("tab", { name: "Telemetry", exact: true }).tap();
    await expect(page.locator("#teleEmpty")).toBeVisible();
    expect(writes).toEqual([]);
  });
});

test("editor keyboard focus stays inside and returns after cancel", async ({ page }) => {
  await open(page);
  await page.locator("#addBtn").click();
  await page.locator("#edClose").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#edCancel")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#edClose")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#addBtn")).toBeFocused();
});
