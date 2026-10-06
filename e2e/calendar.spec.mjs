// Calendar — live dates and dated tasks. No July sample. Join Call / Client file
// enable only when task data supplies a meeting URL / client id.

import { test, expect } from "@playwright/test";
import { CLIENT_ID, CLOSER, TASK_NO_LINK, TASK_WITH_CALL, wireApi, gotoScreen } from "./harness.mjs";

function todayAt(h, min) {
  const d = new Date();
  d.setHours(h, min || 0, 0, 0);
  return d.toISOString();
}

/* Today at 9am, local. Two of the times this spec feeds the calendar are 4pm
   and 6pm, and the "Then" list only shows appointments that are still ahead of
   you — so run the suite after 6pm and those rows are correctly gone and the
   test failed for a reason that had nothing to do with the code. Pinning the
   page's clock to the morning makes both of them the future every time. */
function todayAt9am() {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d;
}

function todayLong() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric"
  });
}

test.describe("Calendar call controls", () => {

  test("Join Call and Client file are disabled with no link or client", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_NO_LINK] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unJoin")).toBeDisabled();
    await expect(page.locator("#unFile")).toBeDisabled();
    await expect(page.locator("#unFile")).toHaveText("Client file");
  });

  test("Join Call enables when meeting_url is present", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_WITH_CALL] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unJoin")).toBeEnabled({ timeout: 10_000 });
  });

  test("Client file enables when client_id is linked", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_WITH_CALL] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unFile")).toBeEnabled({ timeout: 10_000 });
  });

  test("Join Call stores the meeting URL on the button", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_WITH_CALL] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unJoin")).toBeEnabled({ timeout: 10_000 });
    await expect(page.locator("#unJoin")).toHaveAttribute("data-join-url", /meet\.example\.com/);
  });

  test("Client file navigates to the client control panel", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_WITH_CALL] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unFile")).toBeEnabled({ timeout: 10_000 });
    await page.locator("#unFile").click();
    await expect(page).toHaveURL(new RegExp(`client-control-panel\\.html\\?client_id=${CLIENT_ID}`));
  });

  test("Join Call stays disabled without a meeting URL", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({
          ok: true,
          tasks: [{
            id: "task-nocall", client_id: CLIENT_ID, client_name: "Dana Whitfield",
            title: "Follow-up call", due_at: todayAt(16, 0), done: false
          }]
        })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unClient")).toHaveText("Dana Whitfield", { timeout: 10_000 });
    await expect(page.locator("#unJoin")).toBeDisabled();
  });
});

test.describe("Calendar is today's week, not July sample", () => {

  test("date label is actual today and sample chips are gone", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: { "/api/tasks": () => ({ ok: true, tasks: [] }) }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator(".datelabel")).toHaveText(todayLong(), { timeout: 10_000 });
    await expect(page.locator(".weekstrip")).not.toContainText("Priya Nair");
    await expect(page.locator(".weekstrip")).not.toContainText("Derek Owusu");
    await expect(page.locator(".weekstrip")).not.toContainText("Dana Whitlock");
    await expect(page.locator(".day-wrap")).toContainText("Nothing booked.");
    await expect(page.locator("#statBooked")).toHaveText("0");
    await expect(page.locator("#statDone")).toHaveText("0");
    await expect(page.locator("#statNoshow")).toHaveText("—");
    await expect(page.locator("#statShow")).toHaveText("—");
    await expect(page.locator("#statLeft")).toHaveText("0");
  });

  test("week strip counts come from dated tasks", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({
          ok: true,
          tasks: [
            { id: "t1", client_name: "Live Client", title: "Closer call", due_at: todayAt(16, 0), done: false },
            { id: "t2", client_name: "Done Client", title: "Wrap-up", due_at: todayAt(10, 0), done: true }
          ]
        })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#statBooked")).toHaveText("2", { timeout: 10_000 });
    await expect(page.locator("#statDone")).toHaveText("1");
    await expect(page.locator("#statLeft")).toHaveText("1");
    await expect(page.locator(".day-wrap")).toContainText("Live Client");
    await page.locator('#seg span[data-v="week"]').click();
    await expect(page.locator(".weekstrip")).toContainText("Live Client");
    await expect(page.locator(".weekstrip")).not.toContainText("Priya Nair");
  });

  test("Today button returns to the real current day", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: { "/api/tasks": () => ({ ok: true, tasks: [] }) }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator(".datelabel")).toHaveText(todayLong(), { timeout: 10_000 });
    await page.locator(".navbtn").nth(1).click();
    await expect(page.locator(".datelabel")).not.toHaveText(todayLong());
    await page.locator(".today-btn").click();
    await expect(page.locator(".datelabel")).toHaveText(todayLong());
  });
});

test.describe("Calendar Up Next / Then / briefing", () => {

  test("clicking a Then row loads that appointment in Up Next", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({
          ok: true,
          tasks: [
            { id: "task-a", client_id: CLIENT_ID, client_name: "Alpha Person",
              title: "First call", due_at: todayAt(16, 0), done: false },
            { id: "task-b", client_id: CLIENT_ID, client_name: "Beta Person",
              title: "Second call", due_at: todayAt(18, 0), done: false }
          ]
        })
      }
    });
    // See todayAt9am(): without this the 6pm row is in the past after 6pm and
    // this test fails on the clock rather than on the code.
    await page.clock.setFixedTime(todayAt9am());
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unClient")).toHaveText("Alpha Person", { timeout: 10_000 });
    await page.locator('.then-row[data-task-id="task-b"]').click();
    await expect(page.locator("#unClient")).toHaveText("Beta Person");
    await expect(page.locator('.then-row[data-task-id="task-a"]')).toBeVisible();
  });

  test("Before you dial shows the task title, never a UUID", async ({ page }) => {
    const uid = "9af65808-a619-4e65-ae91-239766a006b7";
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({
          ok: true,
          tasks: [{
            id: "task-uid",
            client_name: "Chris ProveFunding",
            title: "Strategy session",
            body: uid,
            due_at: todayAt(16, 0),
            done: false
          }]
        })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unBody")).toHaveText("Strategy session", { timeout: 10_000 });
    await expect(page.locator("#unBody")).not.toContainText(uid);
    await expect(page.locator("#upNext")).not.toContainText(uid);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   HALF A SCHEDULE IS NOT A SCHEDULE.

   The calendar asks for its appointments TWICE — once for work that is still
   open, once for calls that have finished. The first version of this page only
   treated that as a failure when BOTH reads fell over:

       if ((!open || !open.ok) && (!closed || !closed.ok)) return open || closed;

   So when the open read died and the finished read answered "nothing", the page
   was handed { ok:true, tasks:[] } and believed it. Every "nothing booked"
   guard then worked perfectly on a fact that was false, and a person saw a
   calm, mint-green, completely empty week with no warning anywhere on it.

   These tests hold both halves to the same bar, in both directions:
     * either half failing must reach the eye, in plain words;
     * a number that counts a half that did not load must be a dash, never a
       number that is quietly too small;
     * and a genuinely empty week must STILL look genuinely empty — fixing a
       false "all clear" by inventing a false alarm is the same bug wearing a
       different hat.
   ═══════════════════════════════════════════════════════════════════════════ */

/* FHData.banner paints "these are real database rows" in mint. If this colour
   is ever behind a failed or half-failed read, the screen is lying again. */
const MINT_SUCCESS = "rgb(168, 216, 176)";

/* The two reads differ only by done=true / done=false in the address, so a test
   can answer them separately and make exactly one of them fail. */
function splitTasks({ open, done }) {
  return (route, { url }) => (url.includes("done=true") ? done(route) : open(route));
}
const rows = (tasks) => () => ({ ok: true, tasks });
const dbDown = () => (route) => route.fulfill({
  status: 503,
  contentType: "application/json",
  body: JSON.stringify({
    ok: false, error: "db_unavailable",
    message: "The database is not reachable right now."
  })
});
const notJson = () => (route) => route.fulfill({
  status: 200, contentType: "application/json", body: "{not json at all"
});

const bannerColour = (page) =>
  page.locator("#fh-data-banner").evaluate((el) => getComputedStyle(el).backgroundColor);

const FOUR_OPEN = [
  { id: "o1", client_id: CLIENT_ID, client_name: "Dana Whitfield",
    title: "Discovery call", due_at: todayAt(10, 0), done: false, assignee_name: "Casey Reed" },
  { id: "o2", client_name: "Marcus Bell", title: "Funding review", due_at: todayAt(13, 0), done: false },
  { id: "o3", client_name: "Priya Raman", title: "Docs walkthrough", due_at: todayAt(15, 0), done: false },
  { id: "o4", client_name: "Tom Alvarez", title: "Closing call", due_at: todayAt(17, 0), done: false }
];
const ONE_DONE = [
  { id: "d1", client_name: "Erin Cole", title: "Kickoff", due_at: todayAt(9, 0), done: true }
];

test.describe("Calendar never paints a half-read schedule as a whole one", () => {

  test("open read fails, finished read is empty — the week is not shown as empty", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: { "/api/tasks": splitTasks({ open: dbDown(), done: rows([]) }) }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#fh-data-banner")).toBeVisible({ timeout: 10_000 });

    // The exact sentence the old build showed. It must not be here.
    await expect(page.locator(".day-wrap")).not.toContainText("Nothing booked.");
    await expect(page.locator(".day-wrap")).toContainText("Schedule did not load.");
    await expect(page.locator("#unClient")).toHaveText("Schedule did not load.");
    await expect(page.locator("#thenList")).toContainText("Schedule did not load.");

    // Every tile was 0/0/0 before. A count of a thing nobody counted is a dash.
    for (const id of ["#statBooked", "#statDone", "#statNoshow", "#statShow", "#statLeft"]) {
      await expect(page.locator(id)).toHaveText("—");
    }

    await expect(page.locator("#fh-data-banner")).toContainText("We could not load appointments");
    await expect(page.locator("#fh-data-banner")).not.toContainText("live schedule");
    expect(await bannerColour(page),
      "the mint 'these are real rows' banner must never sit over a failed read")
      .not.toBe(MINT_SUCCESS);
    await expect(page.locator(".live-pill").first()).not.toContainText("LIVE");
  });

  test("finished read fails — open work still shows, but no count is guessed", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: { "/api/tasks": splitTasks({ open: rows(FOUR_OPEN), done: dbDown() }) }
    });
    await gotoScreen(page, "calendar.html");

    // What did load is real and is shown — this half-failure must not blank the page.
    await expect(page.locator(".day-wrap")).toContainText("Dana Whitfield", { timeout: 10_000 });
    await expect(page.locator(".day-wrap")).toContainText("Tom Alvarez");
    await expect(page.locator("#statLeft")).toHaveText("4");

    // Booked and Done both count finished calls, and the finished calls are missing.
    await expect(page.locator("#statBooked")).toHaveText("—");
    await expect(page.locator("#statDone")).toHaveText("—");
    await expect(page.locator("#statShow")).toHaveText("—");

    await expect(page.locator(".day-wrap")).toContainText("Completed calls did not load.");
    await expect(page.locator(".weekstrip")).toContainText("done not loaded");
    await expect(page.locator("#fh-data-banner"))
      .toContainText("completed calls could not be loaded");
    expect(await bannerColour(page),
      "a partial read must not be reported with the success colour").not.toBe(MINT_SUCCESS);
    await expect(page.locator(".live-pill").first()).toContainText("PARTIAL");
  });

  test("both reads fail — nothing is claimed at all", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: { "/api/tasks": splitTasks({ open: dbDown(), done: dbDown() }) }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator(".day-wrap")).toContainText("Schedule did not load.", { timeout: 10_000 });
    await expect(page.locator(".day-wrap")).not.toContainText("Nothing booked.");
    await expect(page.locator("#statBooked")).toHaveText("—");
    await expect(page.locator("#statLeft")).toHaveText("—");
    expect(await bannerColour(page)).not.toBe(MINT_SUCCESS);
  });

  test("a real empty week stays a real empty week — no false alarm", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: { "/api/tasks": splitTasks({ open: rows([]), done: rows([]) }) }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator(".day-wrap")).toContainText("Nothing booked.", { timeout: 10_000 });
    await expect(page.locator(".day-wrap")).not.toContainText("did not load");
    await expect(page.locator("#statBooked")).toHaveText("0");
    await expect(page.locator("#statDone")).toHaveText("0");
    await expect(page.locator("#statLeft")).toHaveText("0");
    /* NO STRIP ON A GOOD READ (owner calls 2026-08-27 and 2026-08-28: the
       "sample" and "real" strips were dropped; public/app/data.js banner()
       shows a failed read and nothing else). So "no false alarm" means the
       strip stays away. The LIVE pill is what says the week is real. Until
       2026-10-05 this asserted the mint "live schedule" strip that no longer
       exists. */
    await expect(page.locator("#fh-data-banner")).toBeHidden();
    await expect(page.locator(".live-pill").first()).toContainText("LIVE");
  });

  test("both reads fine — real numbers, success banner, nothing dashed", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: { "/api/tasks": splitTasks({ open: rows(FOUR_OPEN), done: rows(ONE_DONE) }) }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#statBooked")).toHaveText("5", { timeout: 10_000 });
    await expect(page.locator("#statDone")).toHaveText("1");
    await expect(page.locator("#statLeft")).toHaveText("4");
    await expect(page.locator(".day-wrap")).toContainText("Erin Cole");
    await expect(page.locator(".day-wrap")).not.toContainText("did not load");
    await expect(page.locator(".weekstrip")).toContainText("5 booked");
    // A good read draws no strip at all (owner, 2026-08-28; see above).
    await expect(page.locator("#fh-data-banner")).toBeHidden();
    await expect(page.locator(".live-pill").first()).toContainText("LIVE");
  });

  test("an unreadable answer to the open read is a failure, not an empty day", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: { "/api/tasks": splitTasks({ open: notJson(), done: rows([]) }) }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator(".day-wrap")).toContainText("Schedule did not load.", { timeout: 10_000 });
    await expect(page.locator(".day-wrap")).not.toContainText("Nothing booked.");
    await expect(page.locator("#statBooked")).toHaveText("—");
    expect(await bannerColour(page)).not.toBe(MINT_SUCCESS);
  });
});
