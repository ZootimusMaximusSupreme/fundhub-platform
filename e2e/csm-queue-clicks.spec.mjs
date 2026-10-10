// Client Success queue — Start shift, Claim this call, and the interview form.
//
// The list said no test filled the interview form, and the desk had no click
// test at all. This presses the three things a CSM does: clock in (the body
// never names a staff id), claim a call, and save what the client said (at
// least one answer, the right stage, the channel picked).

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER } from "./harness.mjs";

const ME = "5a000000-0000-4000-8000-0000000000c5";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const TASK = "7a000000-0000-4000-8000-000000000001";

const ROW = {
  task_id: TASK, client_id: CLIENT, client_name: "Dana Whitfield", client_code: "FH-000101",
  title: "Halfway check-in call", due_at: new Date(Date.now() + 3600e3).toISOString(),
  owned_codes: ["funding_bundle"], balance_due: null, open_invoices: 0,
  assignee_staff_id: null, source_workflow: "customer-insights-mid", meeting_url: null
};
const QUESTIONS = {
  mid: [{ id: "why_buy", prompt: "Why did you buy?" }, { id: "surprise", prompt: "What surprised you so far?" }],
  post: [{ id: "result", prompt: "What happened with your funding?" }]
};

async function open(page, { claimAnswer, saveAnswer, shift = null } = {}) {
  const calls = { shifts: [], claims: [], saves: [] };
  let queueReads = 0;
  let claimed = false;
  await openScreen(page, "/app/csm-queue.html", { ok: true, staff: { ...OWNER.staff, role: "csm" } }, {
    "/api/shifts": async (route, { method }) => {
      if (method === "POST") {
        const body = route.request().postDataJSON();
        calls.shifts.push(body);
        return json(route, { ok: true, shift: body.action === "clock_in" ? { id: "sh1", staff_id: ME, started_at: new Date().toISOString() } : null });
      }
      return json(route, { ok: true, shift });
    },
    "/api/read/csm-queue": (route) => {
      queueReads += 1;
      return json(route, { ok: true, items: [{ ...ROW, assignee_staff_id: claimed ? ME : null }] });
    },
    "/api/read/customer-insights": { ok: true, items: [], questions: QUESTIONS },
    "/api/tasks": async (route) => {
      const body = route.request().postDataJSON();
      calls.claims.push({ method: route.request().method(), body });
      const out = claimAnswer ? claimAnswer() : null;
      if (out) return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
      claimed = true;
      return json(route, { ok: true, task: { id: body.id, assignee_staff_id: ME } });
    },
    "/api/customer-insights": async (route) => {
      calls.saves.push(route.request().postDataJSON());
      const out = saveAnswer ? saveAnswer() : { status: 201, body: { ok: true, insight: { id: "i1" } } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
  });
  await expect(page.locator(`.card[data-row="${TASK}"]`)).toBeVisible();
  return { calls, queueReads: () => queueReads };
}

test.describe("CSM queue", () => {
  test("Start shift and End shift send only the action; the session names the person", async ({ page }) => {
    const { calls } = await open(page);
    await expect(page.locator("#qClock")).toHaveText("Start shift");
    await page.locator("#qClock").click();
    await expect(page.locator("#qClock")).toHaveText("End shift");
    await page.locator("#qClock").click();
    await expect(page.locator("#qClock")).toHaveText("Start shift");
    expect(calls.shifts).toEqual([{ action: "clock_in" }, { action: "clock_out" }]);
  });

  test("Claim this call claims that task, says so, and the re-read shows it as yours", async ({ page }) => {
    const { calls, queueReads } = await open(page);
    const before = queueReads();
    await page.locator(`[data-claim="${TASK}"]`).click();
    await expect.poll(() => calls.claims.length).toBe(1);
    expect(calls.claims[0]).toEqual({ method: "PATCH", body: { id: TASK, claim: true } });
    await expect(page.locator("body")).toContainText("This call is yours.");
    await expect.poll(() => queueReads()).toBeGreaterThan(before);
    await expect(page.locator(`.card[data-row="${TASK}"]`)).toContainText("Claimed by you");
    await expect(page.locator(`[data-claim="${TASK}"]`)).toHaveCount(0);
  });

  test("a claim a teammate got first is said in plain words and the queue is read again", async ({ page }) => {
    const { calls, queueReads } = await open(page, {
      claimAnswer: () => ({ status: 409, body: { ok: false, error: "already_claimed" } })
    });
    const before = queueReads();
    await page.locator(`[data-claim="${TASK}"]`).click();
    await expect.poll(() => calls.claims.length).toBe(1);
    await expect(page.locator("#qBanner")).toHaveText("Somebody else took this one first.");
    await expect.poll(() => queueReads()).toBeGreaterThan(before);
  });

  test("a claim off shift is refused with the reason: clock in first", async ({ page }) => {
    const { calls } = await open(page, {
      claimAnswer: () => ({ status: 403, body: { ok: false, error: "no_active_shift" } })
    });
    await page.locator(`[data-claim="${TASK}"]`).click();
    await expect.poll(() => calls.claims.length).toBe(1);
    await expect(page.locator("#qBanner")).toHaveText("Clock in first. Work can only be claimed or closed on a shift.");
  });

  test("the interview form: nothing written sends nothing", async ({ page }) => {
    const { calls } = await open(page);
    await page.locator(`[data-open="${TASK}"]`).click();
    await expect(page.locator("#qa-why_buy")).toBeVisible();
    await page.locator(`[data-save="${TASK}"]`).click();
    await expect(page.locator("#qSay")).toHaveText("Write down at least one answer before saving.");
    expect(calls.saves).toEqual([]);
  });

  test("Save these answers sends the client, the task, the stage, the channel, the answers and the notes", async ({ page }) => {
    const { calls } = await open(page);
    await page.locator(`[data-open="${TASK}"]`).click();
    await page.locator("#qChan").selectOption("google_meet");
    await page.locator("#qa-why_buy").fill("  I want a line of credit for inventory. ");
    await page.locator("#qNotes").fill("Call back in May.");
    await page.locator(`[data-save="${TASK}"]`).click();
    await expect.poll(() => calls.saves.length).toBe(1);
    expect(calls.saves[0]).toEqual({
      client_id: CLIENT, task_id: TASK, stage: "mid", channel: "google_meet",
      answers: { why_buy: "I want a line of credit for inventory." }, notes: "Call back in May."
    });
    await expect(page.locator("body")).toContainText("Answers saved for Dana Whitfield.");
    await expect(page.locator("#qa-why_buy")).toHaveCount(0);
  });

  test("a refused save keeps the form and shows the server's sentence", async ({ page }) => {
    const { calls } = await open(page, {
      saveAnswer: () => ({ status: 400, body: { ok: false, error: "consent_missing", message: "This client has not agreed to be interviewed." } })
    });
    await page.locator(`[data-open="${TASK}"]`).click();
    await page.locator("#qa-surprise").fill("How fast it was.");
    await page.locator(`[data-save="${TASK}"]`).click();
    await expect.poll(() => calls.saves.length).toBe(1);
    await expect(page.locator("#qSay")).toHaveText("This client has not agreed to be interviewed.");
    await expect(page.locator("#qa-surprise")).toHaveValue("How fast it was.");
  });
});
