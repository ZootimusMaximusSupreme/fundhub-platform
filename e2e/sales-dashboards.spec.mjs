// Playwright: three sales dashboards + role gates.
import { test, expect } from "@playwright/test";
import { openScreen, OWNER, CLOSER, CLIENT_ID, freezeClock } from "./harness.mjs";

const SALES_MANAGER = {
  ok: true,
  staff: {
    id: "staff-sm", name: "Sarah Whitfield", email: "sarah@fundhub.ai",
    role: "sales_manager", org_id: "org-1", status: "active"
  }
};

const emptyMyNumbers = {
  ok: true,
  staff_id: "staff-2",
  shift: { on_shift: false, reason: "No open shift row" },
  pace: { cash_cents: 0, cash_display: "$0", target_cents: null, target_reason: "No monthly deposits target in staff_targets", rank: null, team_size: 0 },
  month: {
    deposits_closed: 0, close_rate: null, show_rate: null, downsells: 0,
    deposit_to_funded: null, deposit_to_funded_n: { deposits: 0, funded: 0, rate: null },
    avg_funded_cents: null, avg_funded_reason: "n/a",
    calls_held: 0, no_shows: 0, unlogged: 0, prior: { deposits: 0, close_rate: null }
  },
  money: { paid_cents: 0, pending_cents: 0, at_risk_cents: null, at_risk_reason: "n/a", paid_display: "$0", pending_display: "$0" },
  call_quality: { available: false, reason: "Call recording and transcription do not exist yet" },
  compliance: { available: false, reason: "schema ready" },
  team: [],
  owed: [],
  streak: { available: false, reason: "not stored yet" }
};

const emptyFloor = {
  ok: true,
  period: { start: "2026-08-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
  hero: {
    cash_cents: 0, cash_display: "$0", target_cents: null,
    target_reason: "No monthly sales_manager deposits target in staff_targets",
    deposit_to_funded: null, deposit_to_funded_n: { deposits: 0, funded: 0, rate: null }
  },
  funnel: { booked: 0, held: 0, deposits: 0, funded: 0, downsells: 0, downsell_cash_cents: 0 },
  today: { date: "2026-08-17", booked: 0, held: 0, deposits: 0, target_cents: null, target_reason: "No daily sales_manager target in staff_targets" },
  closers: [],
  beliefs: { beliefs: [], sources: [], period: {}, prior: {} },
  compliance: { available: false, reason: "Call recording and transcription do not exist yet", items: [] },
  cold_deals: [],
  recordings: {
    drive_ready: false,
    missing: ["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"],
    items: [],
    reason: "Google Drive is not connected yet. Recordings stay in Meet Recordings until Drive is turned on."
  },
  discipline: {
    unlogged_calls: 0, shifts_started_late: null,
    shifts_detail: { reason: "Needs scheduled shift times" },
    followups_overdue: null, followups_reason: "n/a",
    avg_log_lag_days: null, avg_log_lag_reason: "n/a"
  }
};

const emptyCockpit = {
  ok: true,
  staff: { id: "staff-2", name: "Casey Reed", shift: { on_shift: false, reason: "No open shift" } },
  kpis: {
    cash_today_cents: { cents: 0, display: "$0", deposits: 0 },
    cash_month_cents: 0, deposits: 0, calls_held: 0, no_shows: 0,
    close_rate: null, unlogged: 0, commission_mtd: null, commission_reason: "n/a"
  },
  client: {
    id: CLIENT_ID, name: "Dana Whitfield", business_name: null,
    age_months: null, tags: [], funded: false, pipeline: null
  },
  credit: { available: false, reason: "No crs_results row for this client yet" },
  underwrite: { matched_lenders: 0, lenders: [], applications: [], lenders_reason: "empty" },
  deal: { latest_payment: null, success_fee_percent: 0.1, success_fee_note: "10%" },
  precall: { conversation_count: 0, summary: "No conversation summary on file yet." },
  up_next: [],
  gone_quiet: { unlogged: [], quiet_deposits: [] },
  dispositions: {
    outcomes: ["deposit", "downsell", "callback", "no_show", "not_a_fit"],
    beliefs: ["pain", "doubt", "cost", "desire", "money", "support", "trust"]
  }
};

function salesHandlers({ floorStatus = 200 } = {}) {
  return {
    "/api/read/my-numbers": emptyMyNumbers,
    "/api/read/sales-floor": async (route) => {
      if (floorStatus !== 200) {
        await route.fulfill({
          status: floorStatus,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false, error: "forbidden",
            message: "this endpoint is limited to owner, admin, sales_manager"
          })
        });
        return;
      }
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(emptyFloor)
      });
    },
    "/api/read/closer-call": emptyCockpit,
    "/api/read/closer-now": { ok: true, current: null, next: null },
    "/api/read/underwrite": { ok: true, suggestions: [] },
    "/api/call-outcomes": { ok: true, created: true, outcome: { outcome: "deposit" } },
    "/api/marketing-flags": { ok: true, flag: { id: "flag-1" } }
  };
}

test("my-numbers loads for a closer and shows honest empty call quality", async ({ page }) => {
  await openScreen(page, "/app/my-numbers.html", CLOSER, salesHandlers());
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("text=Call recording and transcription do not exist yet")).toBeVisible();
  await expect(page.locator("text=Deposit → funded")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Marcus Webb");
  await expect(page.locator("body")).not.toContainText("Bianca Souza");
});

test("sales-floor loads for sales_manager and shell bounces a closer home", async ({ page }) => {
  await openScreen(page, "/app/sales-floor.html", SALES_MANAGER, salesHandlers());
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator(".hero").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today's recordings" })).toBeVisible();
  await expect(page.locator("text=Google Drive is not connected yet")).toBeVisible();

  // Closers are not on the sales-floor allow list — shell.js replaces them
  // to their home before the page (or its API 403 banner) can paint.
  const errors = await openScreen(page, "/app/sales-floor.html", CLOSER, salesHandlers({ floorStatus: 403 }));
  await expect(page).toHaveURL(/dashboard\.html/);
  expect(errors).toEqual([]);
});

test("sales-floor loads for owner", async ({ page }) => {
  await openScreen(page, "/app/sales-floor.html", OWNER, salesHandlers());
  await expect(page.locator(".hero").first()).toBeVisible();
});

test("sales-floor Your closers shows Chris, not sample names", async ({ page }) => {
  const floor = {
    ...emptyFloor,
    closers: [{
      staff_id: "staff-chris",
      name: "Chris Stanbridge",
      on_shift: false,
      calls: 2,
      close_rate: 0,
      funded_rate: null,
      cash_cents: 200,
      cash_display: "$2",
      action: null
    }]
  };
  await openScreen(page, "/app/sales-floor.html", OWNER, {
    ...salesHandlers(),
    "/api/read/sales-floor": floor
  });
  const rost = page.locator(".rost");
  await expect(rost).toContainText("Chris Stanbridge");
  await expect(rost).toContainText("Off shift");
  await expect(rost).toContainText("$2");
  await expect(rost).toContainText("0%");
  await expect(rost).not.toContainText("Marcus Webb");
  await expect(rost).not.toContainText("Elena Voss");
  await expect(rost).not.toContainText("Devon Marsh");
  await expect(rost).not.toContainText("Jordan Blake");
  await expect(page.locator("body")).not.toContainText("Devon isn't lazy");
});

test("Closer Dashboard with client_id shows disposition hotkeys", async ({ page }) => {
  await openScreen(page, `/app/closer-dashboard.html?client_id=${CLIENT_ID}`, CLOSER, salesHandlers());
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator("#fh-join")).toBeDisabled();
  await expect(page.locator('[data-belief="desire"]').first()).toBeVisible();
  await expect(page.locator("#fh-present")).toBeVisible();
});

test("Closer Dashboard without client_id shows empty when no current call", async ({ page }) => {
  await openScreen(page, "/app/closer-dashboard.html", CLOSER, salesHandlers());
  await expect(page.locator("#ccp-who-name")).toHaveText("No call right now");
  await expect(page.locator("body")).toContainText("No booked call right now");
  await expect(page.locator(".logbar")).toBeHidden();
  // Present stays on the screen with no call (owner-set 2026-08-27). This
  // assertion used to be toBeHidden(); it was flipped when the rule changed,
  // not deleted, so the new behaviour stays pinned. The disposition logbar
  // above it is still hidden — that one really does need a call to log.
  await expect(page.locator("#fh-present")).toBeVisible();
});

test("Closer Dashboard without client_id loads the current call from closer-now", async ({ page }) => {
  await openScreen(page, "/app/closer-dashboard.html", CLOSER, {
    ...salesHandlers(),
    "/api/read/closer-now": {
      ok: true,
      current: {
        task_id: "t-now",
        client_id: CLIENT_ID,
        name: "Dana Whitfield",
        due_at: "2026-08-17T18:00:00.000Z",
        title: "Close"
      },
      next: null
    }
  });
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator("#fh-present")).toBeVisible();
  await expect(page.locator('[data-belief="desire"]').first()).toBeVisible();
});

test("my-numbers header is the session closer, not Marcus or Elena", async ({ page }) => {
  await openScreen(page, "/app/my-numbers.html", CLOSER, salesHandlers());
  await expect(page.locator("#staffChip")).toContainText("Casey Reed");
  await expect(page.locator("body")).not.toContainText("Marcus Webb");
  await expect(page.locator("body")).not.toContainText("Elena Voss");
  await expect(page.locator("body")).not.toContainText("Devon Marsh");
  await expect(page.locator("body")).not.toContainText("Bianca Souza");
});

test("closer-dashboard without a client is honest empty", async ({ page }) => {
  await freezeClock(page, "2026-08-16T20:00:00Z");
  await openScreen(page, "/app/closer-dashboard.html", CLOSER, salesHandlers());
  await expect(page.locator("#paymentCalculator")).not.toHaveAttribute("open", "");
  await page.locator("#paymentCalculator > summary").click();
  await expect(page.locator("#calcGate")).toBeVisible();
  await expect(page.locator("#calcGate")).toHaveText("Open from a client.");
  await expect(page.locator("#whoName")).toHaveText("Casey Reed");
  // Today's Pipeline was cut 2026-08-17 (owner-set): Closer Dashboard's "Up next"
  // is the same tasks table, five rows deep instead of two.
  await expect(page.locator("#todayPipe")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("no closer shift endpoint");
  await expect(page.locator("body")).not.toContainText("No closer-day pipeline endpoint");
  await expect(page.locator("body")).not.toContainText("Jordan Blake");
  await expect(page.locator("body")).not.toContainText("Priya Nair");
  await expect(page.locator("#fh-workspace-header")).toBeVisible();
  await page.locator("#fh-shell-chip > summary").click();
  await page.locator(".fh-account-technical > summary").click();
  await expect(page.locator("#fh-workspace-clock")).toBeVisible();
  await expect(page.locator(".fh-account-technical")).not.toContainText("Jul 26");
});

