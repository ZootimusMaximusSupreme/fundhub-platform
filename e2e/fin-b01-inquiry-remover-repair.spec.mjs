// Specialist desk, Repair side: the Enroll button on an expanded file and the
// PULL modal behind "Soft pull" (finish-the-853, batch 01).
//
//   Enroll        -> POST /api/repair/enroll {client_id, program:"trial",
//                    price_total:200, amount_paid:200}, one press, one write.
//   PULL modal    -> type PULL; Cancel / Escape / the backdrop close it with
//                    nothing sent; Pull asks the three bureaus one at a time in
//                    order and stops on the first refusal.
//
// NO BACKEND: page.route() answers /api/**. No bureau is asked, nobody is enrolled.
import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

const sessionFor = (role) => ({ ok: true, staff: { ...OWNER.staff, role } });

const FILE = {
  client_id: CLIENT_ID, name: "Dana Whitfield", program: "standard", round: "R1", rounds_cap: 3,
  stage_key: "awaiting_response", stage_label: "Awaiting response",
  response_due_at: "2026-10-20T00:00:00Z", authorization_ok: true, letters_ready: 0, letters_sent: 2,
};
const LIST = { ok: true, files: [FILE], need_me: 0, ready: 0, waiting: 1, stalled: 0, trial_ending: 0 };
const DETAIL = { ok: true, file: FILE, letters: [], items: [], timeline: [], rounds: [], signer_name: null, signed_at: null };

async function open(page, { session = OWNER, enroll, pull } = {}) {
  const calls = { enroll: [], pull: [], listReads: 0 };
  await page.addInitScript(() => { localStorage.setItem("fh_specialist_pane", "repair"); });
  await openScreen(page, "/app/inquiry-remover.html", session, {
    "/api/read/repair-cases": (route, { url }) => {
      if (new URL(url).searchParams.get("client_id")) return json(route, DETAIL);
      calls.listReads += 1;
      return json(route, LIST);
    },
    "/api/repair/enroll": async (route) => {
      calls.enroll.push(JSON.parse(route.request().postData() || "{}"));
      return enroll ? enroll(route) : json(route, { ok: true });
    },
    "/api/finance/crs-pull": async (route) => {
      calls.pull.push(JSON.parse(route.request().postData() || "{}"));
      return pull ? pull(route, calls.pull.length) : json(route, { ok: true });
    },
    "/api/repair/exceptions": { ok: true, stalled: [], lowConfidenceParses: [] },
  });
  await expect(page.locator(`tr[data-repair-row="${CLIENT_ID}"]`)).toBeVisible({ timeout: 10_000 });
  await page.locator(`tr[data-repair-row="${CLIENT_ID}"]`).click();
  await expect(page.locator("tr.repair-expand")).toBeVisible();
  await expect(page.locator('[data-act="repair-enroll"]')).toBeVisible();
  return calls;
}

test.describe("specialist desk: Enroll", () => {
  test("Enroll sends this client into the trial program at 200 paid of 200, once, and the desk reads its queue again", async ({ page }) => {
    const calls = await open(page);
    const before = calls.listReads;
    await page.locator('[data-act="repair-enroll"]').click();
    await expect.poll(() => calls.enroll.length).toBe(1);
    expect(calls.enroll[0]).toEqual({ client_id: CLIENT_ID, program: "trial", price_total: 200, amount_paid: 200 });
    // The desk reads its queue again so the file shows what the server now holds.
    // The repaint also replaces the open row, so the "Enrolled in trial." line the
    // button wrote is gone with it (product finding in the manifest).
    await expect.poll(() => calls.listReads).toBeGreaterThan(before);
    await expect(page.locator("tr.repair-expand")).toHaveCount(0);
    expect(calls.enroll).toHaveLength(1);
  });

  test("a refusal is shown in the server's words, nothing says Enrolled, and the button comes back", async ({ page }) => {
    const calls = await open(page, {
      enroll: (route) => json(route, { ok: false, error: "This client is already in a repair program." }, 409),
    });
    const before = calls.listReads;
    await page.locator('[data-act="repair-enroll"]').click();
    await expect.poll(() => calls.enroll.length).toBe(1);
    await expect(page.locator("[data-send-msg]")).toHaveText("This client is already in a repair program.");
    await expect(page.locator('[data-act="repair-enroll"]')).toBeEnabled();
    expect(calls.listReads).toBe(before);
  });

  test("an answer with no sentence still says Enroll failed", async ({ page }) => {
    await open(page, { enroll: (route) => json(route, { ok: false }, 500) });
    await page.locator('[data-act="repair-enroll"]').click();
    await expect(page.locator("[data-send-msg]")).toHaveText("Enroll failed");
  });
});

const ROLES_THAT_PULL = ["owner", "admin", "closer", "funding_advisor"];
const ROLES_THAT_CANNOT = ["sales_manager", "csm", "setter", "inquiry_specialist"];

test.describe("specialist desk: the PULL modal", () => {
  for (const role of ROLES_THAT_PULL) {
    test(`${role} is offered Soft pull`, async ({ page }) => {
      await open(page, { session: sessionFor(role) });
      await expect(page.locator('[data-act="repair-pull"]')).toBeVisible();
    });
  }
  for (const role of ROLES_THAT_CANNOT) {
    test(`${role} is not offered Soft pull`, async ({ page }) => {
      await open(page, { session: sessionFor(role) });
      await expect(page.locator('[data-act="repair-pull"]')).toHaveCount(0);
    });
  }

  test("the modal opens empty with Pull off, and only the exact word PULL turns it on", async ({ page }) => {
    await open(page);
    await page.locator('[data-act="repair-pull"]').click();
    const modal = page.locator("#repairPullModal");
    await expect(modal).toHaveClass(/\bopen\b/);
    await expect(page.locator("#repairPullInput")).toHaveValue("");
    await expect(page.locator("#repairPullGo")).toBeDisabled();
    await page.locator("#repairPullInput").fill("pull");
    await expect(page.locator("#repairPullGo")).toBeDisabled();
    await page.locator("#repairPullInput").fill("PUL");
    await expect(page.locator("#repairPullGo")).toBeDisabled();
    await page.locator("#repairPullInput").fill("PULL");
    await expect(page.locator("#repairPullGo")).toBeEnabled();
    await page.locator("#repairPullInput").fill("PULLS");
    await expect(page.locator("#repairPullGo")).toBeDisabled();
  });

  test("Cancel closes the modal and sends nothing; opening it again starts empty", async ({ page }) => {
    const calls = await open(page);
    await page.locator('[data-act="repair-pull"]').click();
    await page.locator("#repairPullInput").fill("PULL");
    await page.locator("#repairPullModal .repair-cact [data-repair-close-pull]").click();
    await expect(page.locator("#repairPullModal")).not.toHaveClass(/\bopen\b/);
    expect(calls.pull).toEqual([]);
    await page.locator('[data-act="repair-pull"]').click();
    await expect(page.locator("#repairPullInput")).toHaveValue("");
    await expect(page.locator("#repairPullGo")).toBeDisabled();
  });

  test("Escape closes the modal and sends nothing", async ({ page }) => {
    const calls = await open(page);
    await page.locator('[data-act="repair-pull"]').click();
    await page.locator("#repairPullInput").fill("PULL");
    await page.keyboard.press("Escape");
    await expect(page.locator("#repairPullModal")).not.toHaveClass(/\bopen\b/);
    expect(calls.pull).toEqual([]);
  });

  test("Pull asks the three bureaus one at a time, Experian then Equifax then TransUnion, for this client", async ({ page }) => {
    const calls = await open(page);
    await page.locator('[data-act="repair-pull"]').click();
    await page.locator("#repairPullInput").fill("PULL");
    await page.locator("#repairPullGo").click();
    await expect.poll(() => calls.pull.length).toBe(3);
    expect(calls.pull).toEqual([
      { client_id: CLIENT_ID, bureau: "EX" },
      { client_id: CLIENT_ID, bureau: "EQ" },
      { client_id: CLIENT_ID, bureau: "TU" },
    ]);
    await expect(page.locator("#repairPullModal")).not.toHaveClass(/\bopen\b/);
    await expect(page.locator("#repairErr")).toBeHidden();
  });

  test("the first refusal stops the run: one bureau asked, the modal closes, and the refusal is said", async ({ page }) => {
    const calls = await open(page, {
      pull: (route) => json(route, { ok: false, error: "forbidden", message: "Your login is not allowed to order a credit pull." }, 403),
    });
    await page.locator('[data-act="repair-pull"]').click();
    await page.locator("#repairPullInput").fill("PULL");
    await page.locator("#repairPullGo").click();
    await expect.poll(() => calls.pull.length).toBe(1);
    await expect(page.locator("#repairPullModal")).not.toHaveClass(/\bopen\b/);
    await expect(page.locator("#repairErr")).toBeVisible();
    await expect(page.locator("#repairErr")).not.toHaveText("");
    // Give a second and third request time to appear if the run did not stop.
    await page.waitForTimeout(500);
    expect(calls.pull).toHaveLength(1);
    expect(calls.pull[0].bureau).toBe("EX");
  });

  test("a refusal on the second bureau stops before the third", async ({ page }) => {
    const calls = await open(page, {
      pull: (route, n) => (n === 2
        ? json(route, { ok: false, error: "no_reports", message: "The bureau sent nothing back." }, 502)
        : json(route, { ok: true })),
    });
    await page.locator('[data-act="repair-pull"]').click();
    await page.locator("#repairPullInput").fill("PULL");
    await page.locator("#repairPullGo").click();
    await expect.poll(() => calls.pull.length).toBe(2);
    await page.waitForTimeout(500);
    expect(calls.pull.map((p) => p.bureau)).toEqual(["EX", "EQ"]);
  });

  // Each bureau pull is billable. While the run is going, pressing Pull again must not start a second run.
  test("a second press while the run is going sends nothing: the button says Pulling and stays off, three pulls in all", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const calls = await open(page, {
      pull: async (route, n) => {
        if (n === 1) await held;
        return json(route, { ok: true });
      },
    });
    await page.locator('[data-act="repair-pull"]').click();
    await page.locator("#repairPullInput").fill("PULL");
    await page.locator("#repairPullGo").click();
    await expect.poll(() => calls.pull.length).toBe(1);
    await expect(page.locator("#repairPullGo")).toHaveText("Pulling…");
    await expect(page.locator("#repairPullGo")).toBeDisabled();
    // The press lands on a button that is off; the typed word is still PULL, so nothing else stops it.
    await page.locator("#repairPullGo").click({ force: true });
    await page.waitForTimeout(250);
    expect(calls.pull).toHaveLength(1);
    release();
    await expect.poll(() => calls.pull.length).toBe(3);
    await page.waitForTimeout(400);
    expect(calls.pull.map((p) => p.bureau)).toEqual(["EX", "EQ", "TU"]);
    await expect(page.locator("#repairPullModal")).not.toHaveClass(/\bopen\b/);
  });

  test("after a finished run the button is Pull again, not stuck on Pulling", async ({ page }) => {
    const calls = await open(page);
    await page.locator('[data-act="repair-pull"]').click();
    await page.locator("#repairPullInput").fill("PULL");
    await page.locator("#repairPullGo").click();
    await expect.poll(() => calls.pull.length).toBe(3);
    await page.locator('[data-act="repair-pull"]').click();
    await expect(page.locator("#repairPullGo")).toHaveText("Pull");
    await expect(page.locator("#repairPullGo")).toBeDisabled();
    await page.locator("#repairPullInput").fill("PULL");
    await expect(page.locator("#repairPullGo")).toBeEnabled();
  });
});
