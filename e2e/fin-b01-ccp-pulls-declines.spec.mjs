// Client control panel: the three bureau Pull buttons and the Declines "Save
// outcome" button (finish-the-853, batch 01).
//
//   Pull Equifax / Experian / TransUnion -> POST /api/finance/crs-pull with this
//     client and that bureau's code, only while consent is on file; every
//     refusal is said in words and the pull never claims it finished when it did not.
//   Declines: Save outcome -> POST /api/blueprint/declines action "outcome" with
//     the chosen outcome, the amount, the re-apply day and the notes.
//
// NO BACKEND: page.route() answers /api/**. No bureau is asked.
import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

const CONSENT_OK = { ok: true, status: { valid: true }, identity: { on_file: true }, approval_link: null };

async function openPulls(page, { consent = CONSENT_OK, consentStatus = 200, pull, query = `?client_id=${CLIENT_ID}` } = {}) {
  const pulls = [];
  let consentReads = 0;
  await openScreen(page, `/app/client-control-panel.html${query}`, OWNER, {
    "/api/consent/capture": (route) => {
      consentReads += 1;
      return json(route, consent, consentStatus);
    },
    "/api/finance/crs-pull": async (route) => {
      pulls.push(JSON.parse(route.request().postData() || "{}"));
      return pull ? pull(route, pulls.length) : json(route, { ok: true, stored: true });
    },
  });
  return { pulls, consentReads: () => consentReads };
}

const BUTTONS = [
  ["Pull TransUnion", "#ccp-pull-tu", "TU", "TransUnion"],
  ["Pull Experian", "#ccp-pull-ex", "EX", "Experian"],
  ["Pull Equifax", "#ccp-pull-eq", "EQ", "Equifax"],
];

test.describe("client control panel: bureau pull buttons", () => {
  for (const [name, selector, code, label] of BUTTONS) {
    test(`${name} sends this client and bureau ${code}, once, and says it finished`, async ({ page }) => {
      const { pulls } = await openPulls(page);
      await expect(page.locator("#ccp-consent-state")).toHaveText("Consent is on file. A bureau pull can go ahead.");
      await expect(page.locator(selector)).toBeEnabled();
      await page.locator(selector).click();
      await expect.poll(() => pulls.length).toBe(1);
      expect(pulls[0]).toEqual({ client_id: CLIENT_ID, bureau: code });
      await expect(page.locator("#ccp-pull-status")).toHaveText(`${label} pull finished. Refresh the file to see the stored report.`);
      await expect(page.locator(selector)).toBeEnabled();
    });
  }

  test("each button is for its own bureau: pressing Experian never sends the other two codes", async ({ page }) => {
    const { pulls } = await openPulls(page);
    await page.locator("#ccp-pull-ex").click();
    await expect.poll(() => pulls.length).toBe(1);
    await page.locator("#ccp-pull-tu").click();
    await expect.poll(() => pulls.length).toBe(2);
    expect(pulls.map((p) => p.bureau)).toEqual(["EX", "TU"]);
  });

  test("a missing identity is said in words with its code, and the pull is not reported as finished", async ({ page }) => {
    const { pulls } = await openPulls(page, {
      pull: (route) => json(route, { ok: false, code: "identity_required", error: "identity_required" }, 422),
    });
    await page.locator("#ccp-pull-eq").click();
    await expect.poll(() => pulls.length).toBe(1);
    const status = page.locator("#ccp-pull-status");
    await expect(status).toContainText("No identity on file for this client");
    await expect(status).toContainText("[identity_required]");
    await expect(status).not.toContainText("pull finished");
    await expect(page.locator("#ccp-pull-eq")).toBeEnabled();
  });

  test("a refused consent shows the bank's reason and reads consent again", async ({ page }) => {
    const { pulls, consentReads } = await openPulls(page, {
      pull: (route) => json(route, { ok: false, code: "consent_required", error: "this client took their permission back." }, 403),
    });
    const before = consentReads();
    await page.locator("#ccp-pull-ex").click();
    await expect.poll(() => pulls.length).toBe(1);
    await expect(page.locator("#ccp-pull-status")).toContainText("No consent — this client took their permission back.");
    await expect.poll(() => consentReads()).toBeGreaterThan(before);
  });

  test("a pull that came back with nothing stored is never shown as a finished pull", async ({ page }) => {
    await openPulls(page, {
      pull: (route) => json(route, { ok: false, code: "no_reports", error: "no_reports" }, 502),
    });
    await page.locator("#ccp-pull-tu").click();
    await expect(page.locator("#ccp-pull-status")).toContainText("The bureau was asked and sent nothing back.");
    await expect(page.locator("#ccp-pull-status")).not.toContainText("pull finished");
  });

  test("with no consent on file the three buttons are off with the reason on them, and a press sends nothing", async ({ page }) => {
    const { pulls } = await openPulls(page, {
      consent: { ok: true, status: { valid: false, reason: "revoked" }, identity: { on_file: true }, approval_link: null },
    });
    await expect(page.locator("#ccp-consent-state")).toContainText("This client took their permission back. Do not pull.");
    for (const [, selector] of BUTTONS) {
      await expect(page.locator(selector)).toBeDisabled();
      await expect(page.locator(selector)).toHaveAttribute("title", /took their permission back/);
    }
    await page.locator("#ccp-pull-eq").click({ force: true });
    expect(pulls).toEqual([]);
  });

  test("when consent cannot be checked the buttons stay on and say so", async ({ page }) => {
    await openPulls(page, { consent: { ok: false, error: "boom" }, consentStatus: 500 });
    await expect(page.locator("#ccp-consent-state")).toContainText("Could not check consent from this screen.");
    for (const [, selector] of BUTTONS) await expect(page.locator(selector)).toBeEnabled();
  });

  test("with no client open the buttons are off and nothing is sent", async ({ page }) => {
    const { pulls } = await openPulls(page, { query: "" });
    for (const [, selector] of BUTTONS) await expect(page.locator(selector)).toBeDisabled();
    expect(pulls).toEqual([]);
  });
});

/* ── Declines: Save outcome ─────────────────────────────────────────────── */

const DECLINE = {
  id: "dec0001", bank: "Chase", product: "Ink Business", declined_on: "2026-09-20", bureaus_pulled: ["experian"],
  source: "staff", recorded_by: "Jordan", looks_like_words: "A denial for too many inquiries",
  outcome: "open", outcome_words: "Still working it", outcome_approved_amount: null, reapply_on: null,
  reasons: [], steps: [], timing: {}, letter_phones: [], book: null, rm_on_file: false, recon_on: null,
  letter_text: null, letter_document_id: null, needs_person: false, unknown_parts: [],
};

async function openDeclines(page, { answer, loadAfter } = {}) {
  const posts = [];
  let reads = 0;
  await openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}`, OWNER, {
    "/api/consent/capture": CONSENT_OK,
    "/api/blueprint/declines": async (route, { method }) => {
      if (method === "POST") {
        posts.push(JSON.parse(route.request().postData() || "{}"));
        return answer ? answer(route, posts.length) : json(route, { ok: true, outcome: "approved_on_recon", outcome_words: "Approved on reconsideration", application_status: "Approved" });
      }
      reads += 1;
      const decline = reads > 1 && loadAfter ? loadAfter : DECLINE;
      return json(route, { ok: true, staff: { eligible: true, declines: [decline], applications: [], bank_emails: [], next_sequence_notes: [] } });
    },
  });
  await page.locator("#bp-group .group-title.tog").click();
  await expect(page.locator(".dec-item")).toHaveCount(1);
  await expect(page.locator(".dec-item")).toHaveAttribute("open", "");
  return { posts, reads: () => reads };
}

const item = (page) => page.locator('.dec-item[data-decline="dec0001"]');
const save = (page) => item(page).locator('[data-act="outcome"]');

test.describe("client control panel: Declines, Save outcome", () => {
  test("Save outcome sends the chosen outcome, the amount, the re-apply day and the notes for that decline", async ({ page }) => {
    const { posts } = await openDeclines(page);
    await item(page).locator('[data-field="outcome"]').selectOption("approved_on_recon");
    await item(page).locator('[data-field="amount"]').fill("25,000");
    await item(page).locator('[data-field="notes"]').fill("Banker said yes on the phone");
    await save(page).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({
      action: "outcome", client_id: CLIENT_ID, decline_id: "dec0001",
      outcome: "approved_on_recon", approved_amount: "25,000", reapply_on: null, notes: "Banker said yes on the phone",
    });
    await expect(page.locator("#bp-declines-root")).toContainText("Outcome saved: Approved on reconsideration. The application now says Approved.");
  });

  test("the file is read again after the save and paints what the server now holds", async ({ page }) => {
    const { reads } = await openDeclines(page, {
      loadAfter: { ...DECLINE, outcome: "approved_on_recon", outcome_words: "Approved on reconsideration", outcome_approved_amount: 25000 },
    });
    await item(page).locator('[data-field="outcome"]').selectOption("approved_on_recon");
    await item(page).locator('[data-field="amount"]').fill("25000");
    await save(page).click();
    await expect.poll(() => reads()).toBe(2);
    await expect(item(page).locator(".consent-state")).toHaveText("Approved on reconsideration — $25,000");
  });

  test("blank amount, day and notes are sent as null, never as empty strings", async ({ page }) => {
    const { posts } = await openDeclines(page);
    await item(page).locator('[data-field="outcome"]').selectOption("still_declined");
    await save(page).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].approved_amount).toBe(null);
    expect(posts[0].reapply_on).toBe(null);
    expect(posts[0].notes).toBe(null);
    expect(posts[0].outcome).toBe("still_declined");
  });

  test("Re-apply later with no day typed asks for the day and sends nothing", async ({ page }) => {
    const { posts } = await openDeclines(page);
    await item(page).locator('[data-field="outcome"]').selectOption("reapply_later");
    await save(page).click();
    await expect(item(page).locator('[data-slot="status"]')).toHaveText("Pick the day to apply again.");
    expect(posts).toEqual([]);
  });

  test("Re-apply later with a day sends that day", async ({ page }) => {
    const { posts } = await openDeclines(page);
    await item(page).locator('[data-field="outcome"]').selectOption("reapply_later");
    await item(page).locator('[data-field="reapply"]').fill("2027-01-15");
    await save(page).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].outcome).toBe("reapply_later");
    expect(posts[0].reapply_on).toBe("2027-01-15");
  });

  test("a client who did not buy the Blueprint is told so, and the button comes back", async ({ page }) => {
    await openDeclines(page, { answer: (route) => json(route, { ok: false, error: "not_blueprint_buyer" }, 403) });
    await item(page).locator('[data-field="outcome"]').selectOption("still_declined");
    await save(page).click();
    await expect(item(page).locator('[data-slot="status"]')).toContainText("This client has not paid for the Capital Blueprint");
    await expect(save(page)).toBeEnabled();
    await expect(save(page)).toContainText("Save outcome");
  });

  test("a refusal with its own sentence shows that sentence", async ({ page }) => {
    await openDeclines(page, { answer: (route) => json(route, { ok: false, error: "bad", message: "That amount is not a number." }, 400) });
    await item(page).locator('[data-field="outcome"]').selectOption("approved_on_recon");
    await item(page).locator('[data-field="amount"]').fill("abc");
    await save(page).click();
    await expect(item(page).locator('[data-slot="status"]')).toHaveText("That amount is not a number.");
  });
});
